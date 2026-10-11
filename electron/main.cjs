'use strict';
/**
 * SELFIMPULSE — Electron main process.
 *
 * Why this file is plain CommonJS and not TypeScript: the renderer is already
 * the certified Vite web build in `dist/`, and the Tauri shell is already the
 * shipping desktop target. Electron is added as a SECOND host for that exact
 * same build, so it must not introduce a second compilation pipeline that could
 * drift from the one `npm test` and `tools/rebuild-pack.mjs` certify. Plain CJS
 * keeps the native shell readable, dependency-free and impossible to fork.
 *
 * Security posture (the part that actually matters):
 *   · contextIsolation ON, nodeIntegration OFF, sandbox ON, webSecurity ON.
 *     The renderer gets no `require` and no Node globals.
 *   · The renderer is served over a custom `app://` scheme registered as
 *     `standard` + `secure`, NOT `file://`. That gives the page a real, stable
 *     origin, which means the app's own strict CSP meta tag actually applies
 *     (under `file://` the origin is opaque "null" and the app deliberately
 *     relaxes its CSP, which would silently disable it in the packaged app).
 *     It also makes localStorage persist per-origin instead of per-path.
 *   · Navigation away from the app origin and every `window.open` are denied;
 *     external links go to the OS browser instead.
 *   · `will-download` is intercepted so a renderer-initiated save cannot write
 *     to an arbitrary path without the user's say-so.
 */

const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

/* -------------------------------------------------------------------------- */
/* Chromium sandbox vs. the Windows per-user install directory                */
/* -------------------------------------------------------------------------- */
/**
 * A packaged Windows install lives under `%LOCALAPPDATA%\Programs\<App>`, and
 * the NSIS installer gives that folder an ACL carrying a per-app package SID but
 * NOT `ALL APPLICATION PACKAGES` (S-1-15-2-1). Chromium's sandboxed renderer runs
 * under exactly the token that SID grants, so it cannot read the very directory
 * the app lives in, and Electron aborts the process with a FATAL before a window
 * is ever shown.
 *
 * This is invisible during development (the repo sits on D:\ with permissive
 * ACLs) and fatal on every real install, which is why it is handled here rather
 * than discovered later.
 *
 * The fix is to grant that SID read access to our own install folder before the
 * first window is created. The signed-in user already owns the folder, so this
 * needs no elevation and is a no-op on any machine that already has it. If the
 * grant genuinely cannot be made (a locked-down or non-standard ACL), the
 * sandbox is switched OFF rather than leaving the app unable to start - with
 * contextIsolation and nodeIntegration:false still in force, the renderer still
 * has no Node access.
 */
const ALL_APPLICATION_PACKAGES = '*S-1-15-2-1';
let sandboxEnabled = true;

function ensureSandboxCanReadInstallDir() {
  if (process.platform !== 'win32') return;
  // `process.execPath` rather than `app.getPath('exe')`: this has to be
  // derivable before the app is ready, because Electron's install-dir access
  // check runs during process start-up, ahead of the `ready` event.
  const installDir = path.dirname(process.execPath);
  try {
    execFileSync('icacls', [installDir, '/grant', `${ALL_APPLICATION_PACKAGES}:(OI)(CI)(RX)`], {
      stdio: 'ignore',
      timeout: 20_000,
      windowsHide: true,
    });
  } catch (err) {
    sandboxEnabled = false;
    process.stderr.write(
      `[selfimpulse] sandbox pre-grant failed (${err.message}); ` +
      'running with Chromium sandbox disabled (contextIsolation remains on).\n',
    );
  }
}

// Deliberately at module scope, NOT inside `app.whenReady()`. Electron's
// install_dir_access check aborts the process during start-up, before `ready`
// fires, so a grant made in a ready handler never runs in time.
ensureSandboxCanReadInstallDir();

const ORIGIN = 'app://selfimpulse';
const RENDERER_ROOT = path.join(__dirname, '..', 'dist');

/* `app://` must be declared privileged BEFORE `app.ready`, otherwise the
   registry is already frozen by the time handle() is called. */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4',
};

/** Resolve a request path inside dist/, refusing anything that escapes it. */
function resolveInDist(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const abs = path.resolve(RENDERER_ROOT, rel || 'index.html');
  const rootWithSep = RENDERER_ROOT.endsWith(path.sep) ? RENDERER_ROOT : RENDERER_ROOT + path.sep;
  // `path.resolve` has already collapsed any `..`, so a prefix check is enough
  // to prove the result is still inside the build output.
  if (abs !== RENDERER_ROOT && !abs.startsWith(rootWithSep)) return null;
  return abs;
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let abs = resolveInDist(url.pathname);
    if (!abs) return new Response('Forbidden', { status: 403 });

    // A directory (or the bare origin) serves the app entry point.
    if (!path.extname(abs)) abs = path.join(RENDERER_ROOT, 'index.html');

    try {
      const stat = await fsp.stat(abs);
      if (stat.isDirectory()) abs = path.join(abs, 'index.html');
    } catch {
      // Unknown path: hand back the SPA entry so client-side routing works,
      // and let Vite's own asset 404s surface as real 404s for known files.
      if (path.extname(abs)) return new Response('Not found', { status: 404 });
      abs = path.join(RENDERER_ROOT, 'index.html');
    }

    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    return net.fetch(pathToFileURL(abs).toString(), { bypassCustomProtocolHandlers: true })
      .then((res) => new Response(res.body, { status: res.status, headers: { 'content-type': type } }))
      .catch(() => new Response('Not found', { status: 404 }));
  });
}

/** One window, remembered between launches. */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch { /* first launch */ }
  return { width: 1440, height: 940 };
}

function writeWindowState(win) {
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch { /* non-fatal: losing window geometry must never break a quit */ }
}

let mainWindow = null;

function createWindow() {
  const state = readWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#F4F1EB',
    // The app draws its own title bar and window controls (see the Tauri
    // config), so the OS frame is hidden to match. `-webkit-app-region: drag`
    // is applied to the header below, which is how a frameless Electron window
    // stays draggable.
    frame: false,
    titleBarStyle: 'hidden',
    backgroundMaterial: undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: sandboxEnabled,
      webSecurity: true,
      spellcheck: false,
    },
  });

  if (state.maximized) mainWindow.maximize();

  // Paint only when the first frame is ready, so the launch never flashes white.
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Drag region + transparent chrome for the self-drawn window buttons.
  mainWindow.webContents.insertCSS(`
    .si-top, .si-head { -webkit-app-region: drag; }
    .si-chip, button, input, textarea, select, a, .si-nav-item, .si-mode-btn,
    .composer, .si-foot-btn { -webkit-app-region: no-drag; }
  `).catch(() => { /* renderer not ready; drag is restored on did-finish-load */ });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(`
      .si-top, .si-head { -webkit-app-region: drag; }
      .si-chip, button, input, textarea, select, a, .si-nav-item, .si-mode-btn,
      .composer, .si-foot-btn { -webkit-app-region: no-drag; }
    `).catch(() => {});
  });

  /* --- Lock the renderer down to its own origin -------------------------- */

  // Anything that isn't our own scheme never becomes a window in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  // No attach-to-web-contents: a compromised renderer must not own the window.
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.on('close', () => writeWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  /* The renderer draws its own window buttons, so it has to know the moment the
     frame's maximised state flips — from a double-click, a snap gesture, or a
     drag to the edge — or the restore glyph goes stale. */
  const pushMax = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', pushMax);
  mainWindow.on('unmaximize', pushMax);

  // Renderer-initiated saves go through a real dialog rather than a guessed path.
  session.defaultSession.on('will-download', (_event, item) => {
    const suggested = item.getFilename();
    void dialog
      .showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath('downloads'), suggested) })
      .then(({ canceled, filePath }) => {
        if (canceled || !filePath) { item.cancel(); return; }
        item.setSavePath(filePath);
      })
      .catch(() => item.cancel());
  });

  void mainWindow.loadURL(`${ORIGIN}/index.html`);

  /* SI_SMOKE=1 turns this window into a self-checking harness: it waits for the
   * real renderer to mount, asserts the shell actually painted, writes a PNG so
   * the frame can be eyeballed, and exits non-zero on failure. Without this,
   * "the process started" is indistinguishable from "the app rendered", and a
   * blank window is a silent pass. */
  if (process.env.SI_SMOKE) {
    const check = async (label) => {
      const report = await mainWindow.webContents.executeJavaScript(`(() => {
        const q = (s) => document.querySelector(s);
        const navItem = [...document.querySelectorAll('.si-nav-item')]
          .find((b) => /channels/i.test(b.textContent || ''));
        return {
          title: document.title,
          url: location.href,
          rootChildren: q('#root') ? q('#root').children.length : 0,
          shellPresent: !!q('.si-app'),
          navItems: document.querySelectorAll('.si-nav-item').length,
          channelsNavPresent: !!navItem,
          channelsNavLabel: navItem ? (navItem.textContent || '').trim() : null,
          channelsOuter: !!q('.channels'),
          channelCards: document.querySelectorAll('.ch-card').length,
          channelDoors: [...document.querySelectorAll('.ch-card h3')].map((h) => h.textContent),
          eyebrow: (q('.si-eyebrow') || {}).textContent || null,
          factStrip: document.querySelectorAll('.ch-fact').length,
          testButtons: document.querySelectorAll('.ch-acts .btn').length,
          accent: getComputedStyle(q('.si-app')).getPropertyValue('--si-accent').trim(),
          railBg: getComputedStyle(q('.si-rail')).backgroundColor,
          canvasBg: getComputedStyle(q('.si-content')).backgroundColor,
        };
      })()`);
      report.where = label;
      const png = await mainWindow.webContents.capturePage();
      const out = path.join(app.getPath('temp'), `selfimpulse-smoke-${label}.png`);
      fs.writeFileSync(out, png.toPNG());
      report.screenshot = out;
      return report;
    };

    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 3500));
      let reports = [];
      try {
        reports.push(await check('shell'));
        const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
          const b = [...document.querySelectorAll('.si-nav-item')].find((x) => /channels/i.test(x.textContent || ''));
          if (!b) return false;
          b.click();
          return true;
        })()`);
        await new Promise((r) => setTimeout(r, 1200));
        reports.push({ clickedNav: clicked, ...(await check('channels')) });
      } catch (err) {
        reports.push({ error: String(err) });
      }
      const last = reports[reports.length - 1];
      const ok = !last.error && last.shellPresent && last.rootChildren > 0
        && last.channelsNavPresent && last.channelCards > 0;
      process.stdout.write(`SI_SMOKE ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(reports)}\n`);
      app.exit(ok ? 0 : 1);
    });
  }
}

/* --- Window IPC: the surface src/app/desktop.ts drives -------------------- */

ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => Boolean(mainWindow?.isMaximized()));
ipcMain.handle('window:setFullscreen', (_e, v) => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(Boolean(v));
});
ipcMain.handle('window:setAlwaysOnTop', (_e, v) => {
  mainWindow?.setAlwaysOnTop(Boolean(v), 'floating');
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
}));

ipcMain.handle('shell:openExternal', async (_e, url) => {
  // Only ever hand http(s) to the OS. A file:// or custom-scheme target here
  // would let the renderer launch something arbitrary on the machine.
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

/** The renderer asks for a path; it never receives a filesystem handle. */
ipcMain.handle('dialog:openFile', async (_e, filters) => {
  const props = ['openFile'];
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: props,
    filters: Array.isArray(filters) && filters.length ? filters : undefined,
  });
  if (r.canceled || !r.filePaths.length) return null;
  const file = r.filePaths[0];
  const stat = await fsp.stat(file);
  // Return content, not a path: the renderer stays unable to touch the disk.
  const data = await fsp.readFile(file);
  return { name: path.basename(file), size: stat.size, data: data.toString('base64') };
});

/* --- Lifecycle ----------------------------------------------------------- */

// A second launch focuses the running window instead of starting a rival engine.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (!fs.existsSync(RENDERER_ROOT)) {
      dialog.showErrorBox(
        'SelfImpulse — build missing',
        `The renderer build was not found at:\n${RENDERER_ROOT}\n\nRun "npm run build" first.`,
      );
      app.quit();
      return;
    }
    registerAppProtocol();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
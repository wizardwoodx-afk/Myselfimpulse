'use strict';
/**
 * SELFIMPULSE — Electron preload.
 *
 * This is the ONLY bridge between the renderer and the native shell. It runs
 * with `sandbox: true`, so it has no filesystem, no `require`, and no Node
 * globals beyond what Electron injects. Everything the app can ask of the host
 * is enumerated below, one named call per capability — there is no generic
 * `invoke(channel, ...args)` escape hatch, because that would hand the renderer
 * the whole IPC surface and make the allow-list above decorative.
 *
 * The shape mirrors `src/app/desktop.ts` (`WindowApi`) exactly, so the Tauri and
 * Electron shells are interchangeable behind one renderer API.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Marker read by `detectHost()` in src/app/desktop.ts. */
const hostMarker = { host: 'electron', isElectron: true };

contextBridge.exposeInMainWorld('__SELFIMPULSE_ELECTRON__', hostMarker);

/**
 * `window.selfImpulseDesktop`
 *
 * `window:minimize`, `window:toggleMaximize`, `window:close`,
 * `window:isMaximized`, `window:setFullscreen`, `window:setAlwaysOnTop` mirror
 * the WindowApi contract the Tauri branch already fulfils.
 *
 * `app:info` returns build/runtime identity for the About surface.
 * `openExternal` is hard-restricted to https by the main process.
 * `openFile` returns file CONTENT (base64), never a path.
 */
contextBridge.exposeInMainWorld('selfImpulseDesktop', {
  host: 'electron',

  // ---- window ------------------------------------------------------------
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  setFullscreen: (v) => ipcRenderer.invoke('window:setFullscreen', Boolean(v)),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('window:setAlwaysOnTop', Boolean(v)),

  // Dragging is handled by `-webkit-app-region: drag`, which the main process
  // injects onto the header. A frameless window has no native title bar to
  // grab, so this is intentionally a no-op rather than a fake IPC call.

  // ---- app ---------------------------------------------------------------
  info: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
});

/**
 * Maximised state is pushed rather than polled, because the renderer draws its
 * own window buttons and must restyle the moment the user double-clicks the
 * header or drags the window to an edge — polling would lag behind the frame.
 */
contextBridge.exposeInMainWorld('selfImpulseDesktopEvents', {
  onMaximizedChange: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_e, value) => cb(Boolean(value));
    ipcRenderer.on('window:maximized-changed', listener);
    return () => ipcRenderer.removeListener('window:maximized-changed', listener);
  },
});
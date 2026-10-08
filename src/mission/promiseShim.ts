/**
 * SelfImpulse — the runtime function the PDF readers need and older hosts lack.
 *
 * WHY THIS FILE EXISTS. pdf.js 6 (the text reader, `pdfjs-dist/legacy/build/pdf.mjs`)
 * calls `Promise.withResolvers()`, an ES2024 API. Node 22 and current Chromium ship it;
 * Node 20, older WebKitGTK (Linux desktop webviews) and older Windows WebView2 do not.
 * Without it every PDF read fails with
 *
 *     the PDF reader stopped: Promise.withResolvers is not a function
 *
 * which reads like a corrupt file and is actually a missing runtime function. Documents
 * were refused on those hosts for that reason alone.
 *
 * The browser entry (`src/main.tsx`) has carried the same shim for the packaged web
 * build since 18.x. This module is the same guarantee at the READER seam, so every host
 * — the Node host process, the MCP engine, the dev server, the probes and the desktop
 * webview — is covered by the reader that needs it, rather than by whichever entry
 * happened to boot first. It is a no-op where the platform already provides it.
 *
 * It adds no dependency, no network call and no authority of any kind.
 */
type PromiseWithResolversImpl = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const P = Promise as PromiseConstructor & { withResolvers?: PromiseWithResolversImpl };

if (typeof P.withResolvers !== "function") {
  P.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  } as PromiseWithResolversImpl;
}

/** True when the function is available after this module has run. */
export const PROMISE_WITH_RESOLVERS_AVAILABLE =
  typeof (Promise as PromiseConstructor & { withResolvers?: unknown }).withResolvers === "function";

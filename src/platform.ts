/** Platform detection for gating OS-specific affordances (WSL, UNC paths,
 *  Recycle Bin wording) out of the UI. UA sniffing works in both the packaged
 *  WebView (WebView2 reports "Windows NT", WebKitGTK reports "Linux") and the
 *  browser dev preview, and keeps this module dependency-free. */
export const IS_WINDOWS: boolean =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

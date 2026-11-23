// Messages for screen readers about changes that don't move the focus:
// another folder listed, a new sort order. One polite live region, made on
// first use and kept at the end of <body>, outside React: a region has to
// be in the page before its text changes for the change to be read.

let region: HTMLElement | null = null;

/** Says `text` when the screen reader is next idle. */
export function announce(text: string): void {
  if (typeof document === "undefined") return;
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    region.dataset.announce = "";
    document.body.append(region);
  }
  // A new text node each time, so the same words twice are said twice.
  region.textContent = "";
  region.append(text);
}

// Every text file next to the bundled fonts: their licenses and the index,
// LICENSES.md. Notices.tsx only reaches this through a dynamic import(), so
// the texts (about 100 KB) are their own chunk, loaded when the view opens.
import { compareNotices, type Notice } from "./notices";

const FONTS = "./assets/fonts/";

const files = import.meta.glob<string>(
  ["./assets/fonts/**/*", "!**/*.woff2", "!**/*.woff", "!**/*.ttf", "!**/*.otf"],
  { query: "?raw", import: "default", eager: true },
);

export const NOTICES: Notice[] = Object.entries(files)
  .map(([key, text]) => ({ path: key.slice(FONTS.length), text }))
  .sort(compareNotices);

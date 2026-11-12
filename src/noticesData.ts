// Every license text the app ships: the files next to the bundled fonts
// (LICENSES.md first), then the npm packages and the Rust crates for this
// platform from the generated third-party.json. NoticesScreen.tsx only reaches this
// through a dynamic import(), so the texts are their own chunk, loaded when
// the view opens.
import thirdParty from "./assets/third-party.json";
import { compareNotices, dependencyNotices, fileNotice, type Notice, type ThirdPartyData } from "./notices";
import { IS_WINDOWS } from "./platform";

const FONTS = "./assets/fonts/";

const files = import.meta.glob<string>(
  ["./assets/fonts/**/*", "!**/*.woff2", "!**/*.woff", "!**/*.ttf", "!**/*.otf"],
  { query: "?raw", import: "default", eager: true },
);

export const NOTICES: Notice[] = [
  ...Object.entries(files)
    .map(([key, text]) => fileNotice(key.slice(FONTS.length), text))
    .sort(compareNotices),
  ...dependencyNotices(thirdParty as ThirdPartyData, IS_WINDOWS ? "windows" : "linux"),
];

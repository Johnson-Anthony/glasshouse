// Handler aggregator. Order matters: more-specific handlers first, catch-alls last.
// App.tsx iterates these in order; first handler to return `true` consumes the label.

import type { Handler } from "./types";
import { selectionHandler } from "./selection";
import { viewHandler } from "./view";
import { gitHandler } from "./git";
import { archiveHandler } from "./archive";
import { toolsHandler } from "./tools";
import { navHandler } from "./nav";
import { miscHandler } from "./misc";
import { lastCommandRef } from "../state";

const lastCommandInterceptor: Handler = (label) => {
  if (label !== "Run Last Command") lastCommandRef.value = label;
  return false;
};

export const HANDLERS: Handler[] = [
  lastCommandInterceptor,
  selectionHandler,
  viewHandler,
  gitHandler,
  archiveHandler,
  toolsHandler,
  navHandler,
  miscHandler,
];

export type { Handler, HandlerCtx } from "./types";

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
import { targetHandler } from "./target";
import { appHandler } from "./app";
import { fileOpsHandler } from "./fileOps";

export const HANDLERS: Handler[] = [
  selectionHandler,
  viewHandler,
  gitHandler,
  archiveHandler,
  toolsHandler,
  navHandler,
  miscHandler,
];

// Everything App routes a label through: the context-menu target first, then
// App-level commands, then file ops for the active tab (which stops the chain
// when there is no tab), then the feature handlers.
export const COMMAND_CHAIN: Handler[] = [
  targetHandler,
  appHandler,
  fileOpsHandler,
  ...HANDLERS,
];

export type { AppCommands, Handler, HandlerCtx } from "./types";

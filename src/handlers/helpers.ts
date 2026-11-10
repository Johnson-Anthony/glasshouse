import { gitBlame, type BlameLine } from "../api";
import { dialogs } from "../dialogs/DialogHost";
import { errText } from "../errors";
import type { HandlerCtx } from "./types";

/** The selected paths, or the first entry's path when nothing else is. */
export function selectedOrFirst(ctx: HandlerCtx): string[] {
  if (ctx.selectedPaths.length) return ctx.selectedPaths;
  return ctx.firstPath ? [ctx.firstPath] : [];
}

/** Palette stand-in for a submenu: prompt with the first `shown` items as a
 *  numbered list and return the one picked (undefined if cancelled). Any
 *  number up to the full list is accepted, shown or not. */
export async function pickNumbered<T>(
  title: string,
  items: readonly T[],
  label: (item: T) => string,
  shown: number = Infinity,
): Promise<T | undefined> {
  const picked = await dialogs.showPrompt({
    title,
    message: items.slice(0, shown).map((item, i) => `${i + 1}. ${label(item)}`).join("\n"),
    placeholder: "1",
    validate: (v) => {
      const n = parseInt(v.trim(), 10);
      return (Number.isFinite(n) && n >= 1 && n <= items.length)
        ? null
        : `enter 1..${Math.min(items.length, shown)}`;
    },
  });
  if (picked == null) return undefined;
  return items[parseInt(picked.trim(), 10) - 1];
}

/** Blame `path` into the Blame dialog, or alert why it couldn't be. */
export async function showBlame(
  path: string,
  setBlame: (b: { path: string; lines: BlameLine[] }) => void,
): Promise<void> {
  try {
    const lines = await gitBlame(path, 2000);
    setBlame({ path, lines });
  } catch (err) {
    const msg = errText(err);
    console.error("git blame:", msg);
    void dialogs.showAlert({ title: "git blame failed", variant: "error", message: msg });
  }
}

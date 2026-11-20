// Opening files with other apps: the default one (double-click, Enter,
// Open, Default App), a chooser of the installed apps for the type, and a
// program picked from disk. Every failure is shown, with Choose App… as the
// way on. The backend is commands/open_with.rs.

import {
  openWithApp, openWithApps, openWithDefaultStrict, openWithProgram, pickFile, type AppChoice,
} from "./api";
import type { MenuItemDef } from "./data";
import { dialogs } from "./dialogs/DialogHost";
import { errText } from "./errors";
import { showError } from "./errorDialog";
import { basename } from "./paths";
import { IS_WINDOWS } from "./platform";

/** The most apps the Open With submenu lists; Choose App… has them all. */
export const MENU_APPS_MAX = 12;

/** Open `path` with its default app (`asText`: the plain-text app). When
 *  no app is set for its type, or the app won't start, say so and offer
 *  Choose App…. Never throws. */
export async function openFile(path: string, opts: { asText?: boolean } = {}): Promise<void> {
  const name = basename(path) || path;
  let message: string;
  try {
    const r = await openWithDefaultStrict(path, opts.asText === true);
    if (!r || r.opened) return;
    message = `No app is set to open "${name}"${r.file_type ? ` (${r.file_type})` : ""}.`;
  } catch (e) {
    message = `Couldn't open "${name}": ${errText(e)}`;
  }
  const pick = await dialogs.showChoice({
    title: "open",
    message,
    choices: [{ id: "choose", label: "Choose App…", primary: true }],
  });
  if (pick === "choose") await chooseApp(path);
}

/** The rows a chooser shows for `apps`: the default one marked. */
export function appLabels(apps: readonly AppChoice[]): string[] {
  return apps.map(a => (a.is_default ? `${a.name} (default)` : a.name));
}

export const CHOOSE_PROGRAM = "Choose a program…";

/** Pick an app for `path` from the ones installed for its type, or browse
 *  for a program, and open it with that. */
export async function chooseApp(path: string): Promise<void> {
  const name = basename(path) || path;
  let apps: AppChoice[] = [];
  let message = `Open "${name}" with:`;
  try {
    apps = (await openWithApps(path)) ?? [];
    if (apps.length === 0) message = `No installed app says it opens "${name}". Choose a program to open it with:`;
  } catch (e) {
    message = `Couldn't list the apps for "${name}": ${errText(e)}`;
  }
  const i = await dialogs.showPick({
    title: "open with",
    message,
    items: [...appLabels(apps), CHOOSE_PROGRAM],
    okLabel: "open",
  });
  if (i == null) return;
  if (i < apps.length) await launchApp(apps[i], [path]);
  else await openWithPickedProgram(path);
}

/** Open `paths` with `app`, showing why if it won't start. */
export async function launchApp(app: { id: string; name: string }, paths: string[]): Promise<void> {
  try {
    await openWithApp(app.id, paths);
  } catch (e) {
    void showError({ title: `couldn't start ${app.name}`, err: e });
  }
}

/** Browse for a program and open `path` with it. */
export async function openWithPickedProgram(path: string): Promise<void> {
  let program: string | null;
  try {
    program = await pickFile({
      title: `open ${basename(path) || path} with…`,
      ...(IS_WINDOWS
        ? { filters: [{ name: "Programs", extensions: ["exe", "com", "bat", "cmd"] }] }
        : { defaultPath: "/usr/bin" }),
    });
  } catch (e) {
    void showError({ title: "choose a program", err: e });
    return;
  }
  if (!program) return;
  try {
    await openWithProgram(program, [path]);
  } catch (e) {
    void showError({ title: `couldn't start ${basename(program) || program}`, err: e });
  }
}

/** `items` with each `open-with-apps` list pointed at `path` (the file a
 *  context menu is for), or dropped when there's none. */
export function withOpenWithPath(items: MenuItemDef[], path: string | undefined): MenuItemDef[] {
  return items.flatMap<MenuItemDef>(it => {
    if (it.kind === "dynamic" && it.source === "open-with-apps") return path ? [{ ...it, path }] : [];
    if (it.kind === "sub") return [{ ...it, children: withOpenWithPath(it.children, path) }];
    return [it];
  });
}

/** The Open With submenu's rows for `apps`: one click opens `path`. */
export function openWithMenuItems(apps: readonly AppChoice[], path: string): MenuItemDef[] {
  const labels = appLabels(apps);
  return apps.slice(0, MENU_APPS_MAX).map<MenuItemDef>((a, i) => ({
    kind: "item",
    label: labels[i],
    payload: { type: "open-with-app", app: { id: a.id, name: a.name }, path },
  }));
}

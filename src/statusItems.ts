// What the status bar shows: a list of item ids, saved with the other
// settings (TweakState.statusItems) and set from Preferences → status bar.
// New users get a lean bar; settings saved before the list existed keep
// every item they had. docs/decisions/2026-11-20-first-run-defaults.md

export type StatusItem =
  | "path" | "git" | "items" | "size"
  | "free" | "fs" | "mem" | "cpu" | "net" | "term" | "uptime" | "clock";

export interface StatusItemInfo {
  id: StatusItem;
  label: string;
  hint?: string;
  /** Words the Preferences filter also matches. */
  keys?: string;
}

/** Every item, in the bar's order: the first four on the left. */
export const STATUS_ITEMS: readonly StatusItemInfo[] = [
  { id: "path", label: "folder path", hint: "also in the path bar", keys: "location breadcrumb" },
  { id: "git", label: "git branch", hint: "in a repository; also in the path bar", keys: "repository ahead behind" },
  { id: "items", label: "items", hint: "selected, of how many", keys: "count selection selected" },
  { id: "size", label: "size", hint: "of the selection, or of the folder's files", keys: "bytes total selection" },
  { id: "free", label: "free space", hint: "on the folder's drive", keys: "disk drive volume capacity" },
  { id: "fs", label: "file system", hint: "ext4, NTFS…", keys: "fs format volume" },
  { id: "mem", label: "memory", hint: "the system's, in use", keys: "ram mem usage" },
  { id: "cpu", label: "cpu", hint: "the system's load", keys: "processor usage load" },
  { id: "net", label: "network", hint: "download and upload speed", keys: "net traffic bandwidth" },
  { id: "term", label: "terminal button", hint: "opens the terminal", keys: "shell console" },
  { id: "uptime", label: "uptime", hint: "since the system started", keys: "up time boot" },
  { id: "clock", label: "clock", keys: "time" },
];

export const LEFT_ITEMS: ReadonlySet<StatusItem> = new Set(["path", "git", "items", "size"]);

const IDS = new Set<string>(STATUS_ITEMS.map(i => i.id));

/** New users: what other file managers show. */
export const STATUS_DEFAULTS: readonly StatusItem[] = ["items", "size", "free"];

/** Settings saved before the list existed: everything the bar showed then
 *  (its fake i/o graph and READY badge are gone for everyone). Free space
 *  is new, so it isn't among them. */
export const STATUS_LEGACY: readonly StatusItem[] = [
  "path", "git", "items", "size", "fs", "mem", "cpu", "net", "term", "uptime", "clock",
];

/** The items of saved settings (null: none saved, a new user), in the bar's
 *  order; unknown ids are dropped. */
export function loadStatusItems(saved: Record<string, unknown> | null): StatusItem[] {
  if (!saved) return [...STATUS_DEFAULTS];
  const v = saved.statusItems;
  if (!Array.isArray(v)) return [...STATUS_LEGACY];
  return ordered(v.filter((x): x is StatusItem => typeof x === "string" && IDS.has(x)));
}

/** `items` in the bar's order, each once. */
export function ordered(items: readonly StatusItem[]): StatusItem[] {
  const on = new Set(items);
  return STATUS_ITEMS.map(i => i.id).filter(id => on.has(id));
}

/** `items` with `id` shown or hidden. */
export function withItem(items: readonly StatusItem[], id: StatusItem, show: boolean): StatusItem[] {
  return ordered(show ? [...items, id] : items.filter(x => x !== id));
}

/** What the shown items need fetched: system_info every 2 s, net_rate every
 *  2 s, a clock tick every second. */
export function statusNeeds(items: readonly StatusItem[]): { system: boolean; net: boolean; clock: boolean } {
  const has = (id: StatusItem) => items.includes(id);
  return { system: has("cpu") || has("mem") || has("uptime"), net: has("net"), clock: has("clock") };
}

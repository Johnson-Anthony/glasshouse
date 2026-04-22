// Mock filesystem data + menu definitions for rice:// file manager

export type FileKind = "folder" | "text" | "code" | "img" | "archive" | "exec";
export type GitStatus = "mod" | "add" | "del" | "untracked";

export interface FileRow {
  name: string;
  kind: FileKind;
  size: string;
  date: string;
  tag: string | null;
  git: GitStatus | null;
  hidden: boolean;
  ext: string;
  dimmed?: boolean;
}

export interface SidebarPinned {
  ic: string;
  label: string;
  path: string;
  active?: boolean;
  badge: string | null;
}

export interface SidebarTag {
  color: string;
  label: string;
  count: number;
}

export interface SidebarDevice {
  ic: string;
  label: string;
  meta: string;
}

export interface SidebarRemote {
  ic: string;
  label: string;
  meta: string;
}

export interface SidebarData {
  pinned: SidebarPinned[];
  tags: SidebarTag[];
  devices: SidebarDevice[];
  remote: SidebarRemote[];
}

export interface TreeNode {
  depth: number;
  name: string;
  ic: string;
  open: boolean;
  git: GitStatus | null;
  active?: boolean;
  dim?: boolean;
}

export type MenuItemDef =
  | {
      kind: "item";
      label: string;
      ic?: string;
      kb?: string;
      danger?: boolean;
      check?: boolean;
    }
  | {
      kind: "sub";
      label: string;
      ic?: string;
      children: MenuItemDef[];
    }
  | { kind: "sep" }
  | { kind: "grouplabel"; label: string };

export type MenusData = Record<string, MenuItemDef[]>;

export interface PaletteItem {
  g: string;
  ic: string;
  label: string;
  kb?: string[];
}

export const FILES: FileRow[] = [
  { name: ".git",         kind: "folder", size: "—",    date: "2026-04-18 09:12", tag: null,     git: null,        hidden: true,  ext: "" },
  { name: ".vscode",      kind: "folder", size: "—",    date: "2026-04-20 14:02", tag: null,     git: null,        hidden: true,  ext: "" },
  { name: "node_modules", kind: "folder", size: "342M", date: "2026-04-19 22:41", tag: null,     git: "untracked", hidden: false, ext: "", dimmed: true },
  { name: "src",          kind: "folder", size: "—",    date: "2026-04-22 10:18", tag: "project",git: "mod",       hidden: false, ext: "" },
  { name: "tests",        kind: "folder", size: "—",    date: "2026-04-21 16:03", tag: "project",git: null,        hidden: false, ext: "" },
  { name: "public",       kind: "folder", size: "—",    date: "2026-04-15 11:22", tag: null,     git: null,        hidden: false, ext: "" },
  { name: "docs",         kind: "folder", size: "—",    date: "2026-04-10 08:55", tag: "school", git: null,        hidden: false, ext: "" },
  { name: ".env",         kind: "text",   size: "412 B",date: "2026-04-22 08:04", tag: "secret", git: "mod",       hidden: true,  ext: "env" },
  { name: ".gitignore",   kind: "text",   size: "1.2 K",date: "2026-04-01 13:14", tag: null,     git: null,        hidden: true,  ext: "" },
  { name: "README.md",    kind: "text",   size: "4.8 K",date: "2026-04-22 09:30", tag: null,     git: "mod",       hidden: false, ext: "md" },
  { name: "package.json", kind: "code",   size: "2.1 K",date: "2026-04-20 18:47", tag: null,     git: "mod",       hidden: false, ext: "json" },
  { name: "tsconfig.json",kind: "code",   size: "892 B",date: "2026-04-08 12:00", tag: null,     git: null,        hidden: false, ext: "json" },
  { name: "vite.config.ts",kind: "code",  size: "1.1 K",date: "2026-04-12 15:33", tag: null,     git: null,        hidden: false, ext: "ts" },
  { name: "main.rs",      kind: "code",   size: "12.4K",date: "2026-04-22 10:15", tag: "project",git: "add",       hidden: false, ext: "rs" },
  { name: "parser.py",    kind: "code",   size: "8.7 K",date: "2026-04-22 10:18", tag: "school", git: "mod",       hidden: false, ext: "py" },
  { name: "notes.md",     kind: "text",   size: "22.1K",date: "2026-04-21 23:08", tag: "school", git: null,        hidden: false, ext: "md" },
  { name: "Screenshot_2026-04-22_10-14-03.png", kind: "img", size: "1.8 M", date: "2026-04-22 10:14", tag: "review", git: "untracked", hidden: false, ext: "png" },
  { name: "diagram.svg",  kind: "img",    size: "14.2K",date: "2026-04-20 11:09", tag: null,     git: null,        hidden: false, ext: "svg" },
  { name: "archive_backup.tar.zst", kind: "archive", size: "128 M", date: "2026-04-15 03:22", tag: "archive", git: null, hidden: false, ext: "tar.zst" },
  { name: "build.sh",     kind: "exec",   size: "2.4 K",date: "2026-04-18 17:45", tag: null,     git: null,        hidden: false, ext: "sh" },
];

export const SIDEBAR: SidebarData = {
  pinned: [
    { ic: "󰋜", label: "~", path: "/home/void", active: true, badge: null },
    { ic: "", label: "projects", path: "/home/void/projects", badge: "12" },
    { ic: "", label: "school", path: "/home/void/school", badge: "4" },
    { ic: "", label: "downloads", path: "/home/void/Downloads", badge: "87" },
    { ic: "", label: "screenshots", path: "/home/void/Pictures/screens", badge: "∞" },
    { ic: "", label: "mnt/c/Users", path: "/mnt/c/Users", badge: "wsl" },
  ],
  tags: [
    { color: "var(--magenta)", label: "project", count: 48 },
    { color: "var(--green)",   label: "school",  count: 22 },
    { color: "var(--red)",     label: "secret",  count: 3 },
    { color: "var(--yellow)",  label: "review",  count: 9 },
    { color: "var(--cyan)",    label: "archive", count: 14 },
  ],
  devices: [
    { ic: "", label: "root  /", meta: "51% / 512G" },
    { ic: "", label: "home  /home", meta: "38% / 1.8T" },
    { ic: "", label: "wsl2  ext4", meta: "62% / 256G" },
    { ic: "", label: "SanDisk 128G", meta: "USB-C · FAT32" },
    { ic: "", label: "truenas.local", meta: "SMB · 12T" },
  ],
  remote: [
    { ic: "", label: "origin · git", meta: "github" },
    { ic: "", label: "void@server", meta: "ssh" },
    { ic: "", label: "s3://backups", meta: "rclone" },
  ],
};

export const TREE: TreeNode[] = [
  { depth: 0, name: "home",     ic: "", open: true, git: null },
  { depth: 1, name: "void",     ic: "", open: true, git: null, active: true },
  { depth: 2, name: "projects", ic: "", open: true, git: null },
  { depth: 3, name: "glasshouse", ic: "", open: true, git: "mod" },
  { depth: 4, name: ".git",     ic: "", open: false, git: null, dim: true },
  { depth: 4, name: "src",      ic: "", open: false, git: "mod" },
  { depth: 4, name: "tests",    ic: "", open: false, git: null },
  { depth: 3, name: "web-lab",  ic: "", open: false, git: null },
  { depth: 3, name: "rust-cli", ic: "", open: false, git: "add" },
  { depth: 2, name: "school",   ic: "", open: true, git: null },
  { depth: 3, name: "cs3410",   ic: "", open: false, git: null },
  { depth: 3, name: "math2930", ic: "", open: false, git: null },
  { depth: 2, name: "Downloads",ic: "", open: false, git: null },
  { depth: 2, name: "Pictures", ic: "", open: false, git: null },
  { depth: 0, name: "mnt",      ic: "", open: false, git: null },
  { depth: 0, name: "etc",      ic: "", open: false, git: null },
];

export const MENUS: MenusData = {
  File: [
    { kind: "item", ic: "", label: "New Tab",            kb: "Ctrl+T" },
    { kind: "item", ic: "", label: "New Window",         kb: "Ctrl+N" },
    { kind: "item", ic: "", label: "New Private Session",kb: "Ctrl+Shift+N" },
    { kind: "sub",  ic: "", label: "New",
      children: [
        { kind: "item", label: "Folder",         kb: "Ctrl+Shift+D" },
        { kind: "item", label: "Text File" },
        { kind: "item", label: "Markdown Note" },
        { kind: "item", label: "Script (.sh)" },
        { kind: "item", label: "Python Module" },
        { kind: "item", label: "From Template…" },
      ] },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Open…",              kb: "Ctrl+O" },
    { kind: "item", ic: "", label: "Open in Terminal",   kb: "Ctrl+`" },
    { kind: "item", ic: "", label: "Open in VS Code",    kb: "Ctrl+Shift+E" },
    { kind: "item", ic: "", label: "Open Parent",        kb: "Alt+↑" },
    { kind: "sub",  ic: "", label: "Open Recent",
      children: [
        { kind: "item", label: "~/projects/glasshouse" },
        { kind: "item", label: "~/school/cs3410/lab07" },
        { kind: "item", label: "/mnt/c/Users/you/Desktop" },
        { kind: "item", label: "~/Downloads" },
        { kind: "sep" },
        { kind: "item", label: "Clear History" },
      ] },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Save Session",       kb: "Ctrl+Alt+S" },
    { kind: "item", ic: "", label: "Import Session…" },
    { kind: "item", ic: "", label: "Export Layout (.ricerc)" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Close Tab",          kb: "Ctrl+W" },
    { kind: "item", ic: "", label: "Close Other Tabs" },
    { kind: "item", ic: "", label: "Quit",               kb: "Ctrl+Q", danger: true },
  ],
  Edit: [
    { kind: "item", ic: "", label: "Undo",                kb: "Ctrl+Z" },
    { kind: "item", ic: "", label: "Redo",                kb: "Ctrl+Shift+Z" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Cut",                 kb: "Ctrl+X" },
    { kind: "item", ic: "", label: "Copy",                kb: "Ctrl+C" },
    { kind: "item", ic: "", label: "Copy Path",           kb: "Ctrl+Shift+C" },
    { kind: "item", ic: "", label: "Copy Path (WSL)",     kb: "Ctrl+Alt+C" },
    { kind: "item", ic: "", label: "Copy as UNC" },
    { kind: "item", ic: "", label: "Paste",               kb: "Ctrl+V" },
    { kind: "sub",  ic: "", label: "Paste Special",
      children: [
        { kind: "item", label: "Paste as Link (symlink)" },
        { kind: "item", label: "Paste as Hard Link" },
        { kind: "item", label: "Paste as Copy (verify SHA256)" },
        { kind: "item", label: "Paste Text into Filename" },
      ] },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Rename",              kb: "F2" },
    { kind: "item", ic: "", label: "Bulk Rename…",        kb: "Ctrl+Shift+R" },
    { kind: "item", ic: "", label: "Move to Trash",       kb: "Del" },
    { kind: "item", ic: "", label: "Delete Permanently",  kb: "Shift+Del", danger: true },
    { kind: "item", ic: "", label: "Shred (srm)",         danger: true },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Preferences…",        kb: "Ctrl+," },
    { kind: "item", ic: "", label: "Keybindings…" },
    { kind: "item", ic: "", label: "Edit .ricerc" },
  ],
  Select: [
    { kind: "item", ic: "", label: "Select All",          kb: "Ctrl+A" },
    { kind: "item", ic: "", label: "Invert Selection",    kb: "Ctrl+I" },
    { kind: "item", ic: "", label: "Deselect",            kb: "Esc" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Select by Pattern…",  kb: "*" },
    { kind: "item", ic: "", label: "Select by Regex…" },
    { kind: "item", ic: "", label: "Select by Tag →" },
    { kind: "item", ic: "", label: "Select by Extension →" },
    { kind: "item", ic: "", label: "Select Modified (Git)" },
    { kind: "item", ic: "", label: "Select Untracked" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Expand Selection to Folder" },
    { kind: "item", ic: "", label: "Extend to Line End (Visual)" },
    { kind: "item", ic: "", label: "Add Next Match",      kb: "Ctrl+D" },
  ],
  View: [
    { kind: "sub",  ic: "", label: "Layout",
      children: [
        { kind: "item", label: "Tree + Pane + Inspector", kb: "F3", check: true },
        { kind: "item", label: "Miller Columns (ranger)", kb: "F4" },
        { kind: "item", label: "Dual Pane (top/bottom)",  kb: "F5" },
        { kind: "item", label: "Tmux Quad (4-pane)",      kb: "F6" },
        { kind: "item", label: "Single Pane"             ,kb: "F7" },
      ] },
    { kind: "sub",  ic: "", label: "Display Mode",
      children: [
        { kind: "item", label: "Details (rows)",          kb: "Ctrl+1", check: true },
        { kind: "item", label: "Compact List",            kb: "Ctrl+2" },
        { kind: "item", label: "Icons",                   kb: "Ctrl+3" },
        { kind: "item", label: "Tiles",                   kb: "Ctrl+4" },
        { kind: "item", label: "Grid (thumbs)",           kb: "Ctrl+5" },
        { kind: "item", label: "Tree Flat",               kb: "Ctrl+6" },
      ] },
    { kind: "sub",  ic: "", label: "Sort By",
      children: [
        { kind: "item", label: "Name",                    check: true },
        { kind: "item", label: "Size" },
        { kind: "item", label: "Modified" },
        { kind: "item", label: "Type / Extension" },
        { kind: "item", label: "Git Status" },
        { kind: "item", label: "Tag / Color" },
        { kind: "sep" },
        { kind: "item", label: "Descending" },
        { kind: "item", label: "Folders First",           check: true },
      ] },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Show Hidden Files",   kb: "Ctrl+H" },
    { kind: "item", ic: "", label: "Show Ignored (.gitignore)" },
    { kind: "item", ic: "", label: "Show File Extensions", check: true },
    { kind: "item", ic: "", label: "Show Git Gutters",    check: true },
    { kind: "item", ic: "", label: "Show Checksums" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Sidebar",             kb: "Ctrl+B", check: true },
    { kind: "item", ic: "", label: "Inspector",           kb: "Ctrl+J", check: true },
    { kind: "item", ic: "", label: "Terminal Drawer",     kb: "Ctrl+`" },
    { kind: "item", ic: "", label: "Status Bar",          check: true },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Zoom In",             kb: "Ctrl+=" },
    { kind: "item", ic: "", label: "Zoom Out",            kb: "Ctrl+-" },
    { kind: "item", ic: "", label: "Reset Zoom",          kb: "Ctrl+0" },
    { kind: "item", ic: "", label: "Full Screen",         kb: "F11" },
  ],
  Go: [
    { kind: "item", ic: "", label: "Back",                kb: "Alt+←" },
    { kind: "item", ic: "", label: "Forward",             kb: "Alt+→" },
    { kind: "item", ic: "", label: "Up one level",        kb: "Alt+↑" },
    { kind: "item", ic: "", label: "Refresh",             kb: "F5" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Home",                kb: "Ctrl+Home" },
    { kind: "item", ic: "", label: "Root  /" },
    { kind: "item", ic: "", label: "Desktop" },
    { kind: "item", ic: "", label: "Documents" },
    { kind: "item", ic: "", label: "Downloads" },
    { kind: "item", ic: "", label: "Pictures" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Go to Path…",         kb: "Ctrl+L" },
    { kind: "item", ic: "", label: "Go to WSL Distro…" },
    { kind: "item", ic: "", label: "Connect to Server…",  kb: "Ctrl+Shift+G" },
    { kind: "item", ic: "", label: "SSH: void@server" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Trash" },
    { kind: "item", ic: "", label: "Previous Location",   kb: "Ctrl+[" },
    { kind: "item", ic: "", label: "Next Location",       kb: "Ctrl+]" },
  ],
  Bookmarks: [
    { kind: "item", ic: "", label: "Bookmark This Folder",kb: "Ctrl+D" },
    { kind: "item", ic: "", label: "Manage Bookmarks…" },
    { kind: "sep" },
    { kind: "grouplabel", label: "PINNED" },
    { kind: "item", ic: "", label: "~/projects/glasshouse" },
    { kind: "item", ic: "", label: "~/school/cs3410" },
    { kind: "item", ic: "", label: "/mnt/c/Users/you/Desktop" },
    { kind: "item", ic: "", label: "~/Pictures/screens" },
    { kind: "grouplabel", label: "RECENT" },
    { kind: "item", ic: "", label: "~/Downloads" },
    { kind: "item", ic: "", label: "~/.config/nvim" },
    { kind: "item", ic: "", label: "/etc/nginx" },
  ],
  Tools: [
    { kind: "item", ic: "", label: "Bulk Rename…",        kb: "Ctrl+Shift+R" },
    { kind: "item", ic: "", label: "Batch Permissions…",  kb: "Ctrl+Shift+P" },
    { kind: "item", ic: "", label: "Change Owner (chown)…" },
    { kind: "item", ic: "", label: "Find & Replace in Files", kb: "Ctrl+Shift+F" },
    { kind: "sep" },
    { kind: "sub",  ic: "", label: "Compress",
      children: [
        { kind: "item", label: "Zip (.zip)" },
        { kind: "item", label: "Tar + gzip (.tar.gz)" },
        { kind: "item", label: "Tar + zstd (.tar.zst)" },
        { kind: "item", label: "7-zip (.7z)" },
      ] },
    { kind: "sub",  ic: "", label: "Extract",
      children: [
        { kind: "item", label: "Extract Here" },
        { kind: "item", label: "Extract to Folder…" },
        { kind: "item", label: "Browse archive in place" },
      ] },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Checksum (SHA256)" },
    { kind: "item", ic: "", label: "Verify Signature…" },
    { kind: "item", ic: "", label: "Compare Files (diff)" },
    { kind: "item", ic: "", label: "Hex Viewer" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Screenshot → Auto-sort" },
    { kind: "item", ic: "", label: "Clipboard Stack",     kb: "Ctrl+Shift+V" },
    { kind: "item", ic: "", label: "File Queue" },
    { kind: "item", ic: "", label: "Run Script on Selection…" },
  ],
  Git: [
    { kind: "item", ic: "", label: "Status",              kb: "Ctrl+G S" },
    { kind: "item", ic: "", label: "Stage Selected",      kb: "Ctrl+G A" },
    { kind: "item", ic: "", label: "Unstage Selected" },
    { kind: "item", ic: "", label: "Commit…",             kb: "Ctrl+G C" },
    { kind: "item", ic: "", label: "Commit Amend" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Pull",                kb: "Ctrl+G P" },
    { kind: "item", ic: "", label: "Push" },
    { kind: "item", ic: "", label: "Fetch All" },
    { kind: "sub",  ic: "", label: "Branches",
      children: [
        { kind: "item", label: "* main", check: true },
        { kind: "item", label: "  feat/command-palette" },
        { kind: "item", label: "  wip/theme-switcher" },
        { kind: "sep" },
        { kind: "item", label: "New Branch…" },
        { kind: "item", label: "Checkout…" },
        { kind: "item", label: "Merge…" },
        { kind: "item", label: "Rebase onto…" },
      ] },
    { kind: "item", ic: "", label: "Log (graph)" },
    { kind: "item", ic: "", label: "Blame Selected" },
    { kind: "item", ic: "", label: "Stash" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Discard Changes", danger: true },
    { kind: "item", ic: "", label: "Clean Untracked…", danger: true },
  ],
  Terminal: [
    { kind: "item", ic: "", label: "Toggle Drawer",       kb: "Ctrl+`" },
    { kind: "item", ic: "", label: "Open in New Window",  kb: "Ctrl+Shift+`" },
    { kind: "item", ic: "", label: "New Tab",             kb: "Ctrl+Shift+T" },
    { kind: "sub",  ic: "", label: "Profile",
      children: [
        { kind: "item", label: "bash" },
        { kind: "item", label: "zsh", check: true },
        { kind: "item", label: "fish" },
        { kind: "item", label: "PowerShell" },
        { kind: "item", label: "WSL · Ubuntu", check: true },
        { kind: "item", label: "WSL · Debian" },
        { kind: "item", label: "SSH: void@server" },
      ] },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Split Horizontal",    kb: "Ctrl+Shift+H" },
    { kind: "item", ic: "", label: "Split Vertical",      kb: "Ctrl+Shift+V" },
    { kind: "item", ic: "", label: "Zoom Pane",           kb: "Ctrl+Shift+Z" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Run Last Command" },
    { kind: "item", ic: "", label: "Send Path to Shell" },
    { kind: "item", ic: "", label: "cd Here" },
  ],
  Window: [
    { kind: "item", ic: "", label: "Next Tab",            kb: "Ctrl+Tab" },
    { kind: "item", ic: "", label: "Prev Tab",            kb: "Ctrl+Shift+Tab" },
    { kind: "item", ic: "", label: "Move Tab →" },
    { kind: "item", ic: "", label: "Move Tab ←" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Split Right" },
    { kind: "item", ic: "", label: "Split Down" },
    { kind: "item", ic: "", label: "Focus Pane ↑" },
    { kind: "item", ic: "", label: "Focus Pane ↓" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Always on Top" },
    { kind: "item", ic: "", label: "Pin to Workspace" },
    { kind: "item", ic: "", label: "Snap Left / Right" },
    { kind: "item", ic: "", label: "Minimize",            kb: "Ctrl+M" },
    { kind: "item", ic: "", label: "Close Window" },
  ],
  Help: [
    { kind: "item", ic: "", label: "Command Palette",     kb: "Ctrl+P" },
    { kind: "item", ic: "", label: "Keybinding Cheatsheet",kb: "Ctrl+?" },
    { kind: "item", ic: "", label: "Documentation" },
    { kind: "item", ic: "", label: "Release Notes" },
    { kind: "sep" },
    { kind: "item", ic: "", label: "Report Bug…" },
    { kind: "item", ic: "", label: "Check for Updates" },
    { kind: "item", ic: "", label: "About rice://" },
  ],
};

export const PALETTE: PaletteItem[] = [
  { g: "NAVIGATE", ic: "", label: "Go to Path…",          kb: ["Ctrl", "L"] },
  { g: "NAVIGATE", ic: "", label: "Find File by Name (fuzzy)", kb: ["Ctrl", "P"] },
  { g: "NAVIGATE", ic: "", label: "Find in Files",        kb: ["Ctrl", "Shift", "F"] },
  { g: "NAVIGATE", ic: "", label: "Jump to Bookmark →" },
  { g: "NAVIGATE", ic: "", label: "Open Recent →" },
  { g: "FILE",     ic: "", label: "New Folder",            kb: ["Ctrl", "Shift", "D"] },
  { g: "FILE",     ic: "", label: "Bulk Rename…",          kb: ["Ctrl", "Shift", "R"] },
  { g: "FILE",     ic: "", label: "Batch Permissions…" },
  { g: "FILE",     ic: "", label: "Hash SHA256 of Selection" },
  { g: "GIT",      ic: "", label: "Git: Stage Selected" },
  { g: "GIT",      ic: "", label: "Git: Commit…",          kb: ["Ctrl","G","C"] },
  { g: "GIT",      ic: "", label: "Git: Checkout Branch →"  },
  { g: "VIEW",     ic: "", label: "Switch Theme →"  },
  { g: "VIEW",     ic: "", label: "Toggle Hidden Files",   kb: ["Ctrl","H"] },
  { g: "VIEW",     ic: "", label: "Change Layout →" },
  { g: "TOOLS",    ic: "", label: "Open in Terminal",       kb: ["Ctrl","`"] },
  { g: "TOOLS",    ic: "", label: "Open in VS Code",        kb: ["Ctrl","Shift","E"] },
  { g: "TOOLS",    ic: "", label: "Run Script on Selection…" },
];

export const CONTEXT_FILE: MenuItemDef[] = [
  { kind: "item", ic: "", label: "Open",              kb: "Enter" },
  { kind: "item", ic: "", label: "Open With →" },
  { kind: "item", ic: "", label: "Open in Terminal",  kb: "Ctrl+`" },
  { kind: "item", ic: "", label: "Open in VS Code",   kb: "Ctrl+Shift+E" },
  { kind: "item", ic: "", label: "Reveal in Tree" },
  { kind: "sep" },
  { kind: "item", ic: "", label: "Cut",               kb: "Ctrl+X" },
  { kind: "item", ic: "", label: "Copy",              kb: "Ctrl+C" },
  { kind: "item", ic: "", label: "Copy Path" },
  { kind: "item", ic: "", label: "Copy as WSL Path" },
  { kind: "item", ic: "", label: "Duplicate",         kb: "Ctrl+U" },
  { kind: "sep" },
  { kind: "item", ic: "", label: "Rename",            kb: "F2" },
  { kind: "item", ic: "", label: "Move to…",          kb: "F6" },
  { kind: "item", ic: "", label: "Create Symlink…" },
  { kind: "item", ic: "", label: "Tag →" },
  { kind: "sep" },
  { kind: "item", ic: "", label: "Compress →" },
  { kind: "item", ic: "", label: "Checksum SHA256" },
  { kind: "item", ic: "", label: "Hex Viewer" },
  { kind: "item", ic: "", label: "Diff with Clipboard" },
  { kind: "sep" },
  { kind: "item", ic: "", label: "Git: Stage" },
  { kind: "item", ic: "", label: "Git: Discard changes", danger: true },
  { kind: "item", ic: "", label: "Git: Blame" },
  { kind: "sep" },
  { kind: "item", ic: "", label: "Properties",        kb: "Alt+Enter" },
  { kind: "item", ic: "", label: "Move to Trash",     kb: "Del", danger: true },
];

export const CONTEXT_EMPTY: MenuItemDef[] = [
  { kind: "sub",  ic: "", label: "New",
    children: [
      { kind: "item", label: "Folder" },
      { kind: "item", label: "Text File" },
      { kind: "item", label: "Markdown Note" },
      { kind: "item", label: "Script (.sh)" },
      { kind: "item", label: "From Template…" },
    ] },
  { kind: "item", ic: "", label: "Paste",             kb: "Ctrl+V" },
  { kind: "item", ic: "", label: "Paste Special →" },
  { kind: "sep" },
  { kind: "item", ic: "", label: "Open in Terminal",  kb: "Ctrl+`" },
  { kind: "item", ic: "", label: "Open in VS Code" },
  { kind: "item", ic: "", label: "Bookmark Folder",   kb: "Ctrl+D" },
  { kind: "sep" },
  { kind: "sub",  ic: "", label: "Sort By",
    children: [
      { kind: "item", label: "Name" },
      { kind: "item", label: "Size" },
      { kind: "item", label: "Modified" },
      { kind: "item", label: "Type" },
      { kind: "item", label: "Git Status" },
    ] },
  { kind: "item", ic: "", label: "Refresh",           kb: "F5" },
];

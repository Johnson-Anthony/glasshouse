//! The apps that open a file on Linux, and launching one without a shell.
//!
//! - A file's MIME type comes from shared-mime-info's glob lists (`globs2`),
//!   with its aliases and parent types.
//! - Apps are desktop entries (`*.desktop` under each XDG data dir's
//!   `applications/`), matched to types by the XDG MIME Applications spec:
//!   `mimeapps.list` defaults, added and removed associations, then each
//!   entry's `MimeType=`.
//! - An entry starts by its `Exec` line: split into words first, then field
//!   codes (`%f %F %u %U`…) replaced inside those words, so a file name is
//!   always whole arguments and never parsed by anything.
//!
//! The parsing is pure and tested on every platform; only the launch is
//! Unix-only. See docs/decisions/2026-11-20-open-with-linux-apps.md.
#![cfg_attr(windows, allow(dead_code))]

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

use super::open_with::AppChoice;

// ---------- base directories ----------

/// The XDG base directories, most important first.
#[derive(Debug, Clone, Default)]
pub(crate) struct XdgDirs {
    pub data_home: PathBuf,
    pub data_dirs: Vec<PathBuf>,
    pub config_home: PathBuf,
    pub config_dirs: Vec<PathBuf>,
    /// `XDG_CURRENT_DESKTOP`, lowercased, in order.
    pub desktops: Vec<String>,
}

impl XdgDirs {
    /// From the environment, with the spec's defaults. Relative paths are
    /// invalid there, and are skipped.
    pub fn from_env() -> Option<Self> {
        let home = PathBuf::from(std::env::var_os("HOME")?);
        let one = |key: &str, default: PathBuf| {
            std::env::var_os(key)
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .unwrap_or(default)
        };
        let list = |key: &str, default: &str| -> Vec<PathBuf> {
            let v = std::env::var_os(key).filter(|v| !v.is_empty());
            let v = v.unwrap_or_else(|| default.into());
            std::env::split_paths(&v).filter(|p| p.is_absolute()).collect()
        };
        let desktops = std::env::var("XDG_CURRENT_DESKTOP")
            .unwrap_or_default()
            .split(':')
            .filter(|d| !d.is_empty())
            .map(str::to_ascii_lowercase)
            .collect();
        Some(XdgDirs {
            data_home: one("XDG_DATA_HOME", home.join(".local/share")),
            data_dirs: list("XDG_DATA_DIRS", "/usr/local/share:/usr/share"),
            config_home: one("XDG_CONFIG_HOME", home.join(".config")),
            config_dirs: list("XDG_CONFIG_DIRS", "/etc/xdg"),
            desktops,
        })
    }

    /// The data dirs, most important first: the user's, then the system's.
    fn data(&self) -> impl Iterator<Item = &PathBuf> {
        std::iter::once(&self.data_home).chain(&self.data_dirs)
    }

    /// Every `mimeapps.list` the spec names, most important first. A
    /// desktop-specific `<desktop>-mimeapps.list` comes before the plain one
    /// in the same folder.
    pub(crate) fn mimeapps_lists(&self) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let mut add = |dir: &Path| {
            for d in &self.desktops {
                out.push(dir.join(format!("{d}-mimeapps.list")));
            }
            out.push(dir.join("mimeapps.list"));
        };
        add(&self.config_home);
        for d in &self.config_dirs {
            add(d);
        }
        // Deprecated locations, still read.
        add(&self.data_home.join("applications"));
        for d in &self.data_dirs {
            add(&d.join("applications"));
        }
        out
    }
}

// ---------- MIME types ----------

#[derive(Debug, Clone)]
struct Glob {
    weight: u32,
    mime: String,
    /// Lowercased unless `case_sensitive`.
    pattern: String,
    case_sensitive: bool,
}

/// shared-mime-info's globs, aliases and parent types.
#[derive(Debug, Default)]
pub(crate) struct MimeDb {
    globs: Vec<Glob>,
    aliases: HashMap<String, String>,
    parents: HashMap<String, Vec<String>>,
}

impl MimeDb {
    pub fn load(dirs: &XdgDirs) -> Self {
        let mut db = MimeDb::default();
        // A `__NOGLOBS__` line drops the type's globs from less important dirs.
        let mut no_globs: HashSet<String> = HashSet::new();
        for base in dirs.data() {
            let mime = base.join("mime");
            let (globs, cleared) = read_globs(&mime);
            db.globs.extend(globs.into_iter().filter(|g| !no_globs.contains(&g.mime)));
            no_globs.extend(cleared);
            for (alias, canonical) in read_pairs(&mime.join("aliases")) {
                db.aliases.entry(alias).or_insert(canonical);
            }
            for (child, parent) in read_pairs(&mime.join("subclasses")) {
                let list = db.parents.entry(child).or_default();
                if !list.contains(&parent) {
                    list.push(parent);
                }
            }
        }
        db
    }

    /// No glob list was found, so no type can be told from a name.
    pub fn is_empty(&self) -> bool {
        self.globs.is_empty()
    }

    pub fn unalias<'a>(&'a self, mime: &'a str) -> &'a str {
        self.aliases.get(mime).map(String::as_str).unwrap_or(mime)
    }

    /// The type a file name's globs give: the highest weight, then the
    /// longest pattern, then a case-sensitive pattern over one that isn't.
    /// Patterns match case-insensitively unless marked `cs`.
    pub fn type_for_name(&self, name: &str) -> Option<String> {
        let lower = name.to_lowercase();
        let mut best: Option<&Glob> = None;
        for g in &self.globs {
            let subject = if g.case_sensitive { name } else { lower.as_str() };
            if !glob_match(&g.pattern, subject) {
                continue;
            }
            let rank = |g: &Glob| (g.weight, g.pattern.chars().count(), g.case_sensitive);
            let better = best.is_none_or(|b| rank(g) > rank(b));
            if better {
                best = Some(g);
            }
        }
        best.map(|g| self.unalias(&g.mime).to_string())
    }

    /// `mime` and the types it's a kind of, nearest first: its parents
    /// (breadth first), and `text/plain` for any text type.
    pub fn type_chain(&self, mime: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut queue = VecDeque::from([self.unalias(mime).to_string()]);
        while let Some(t) = queue.pop_front() {
            if out.contains(&t) {
                continue;
            }
            if let Some(ps) = self.parents.get(&t) {
                queue.extend(ps.iter().map(|p| self.unalias(p).to_string()));
            }
            out.push(t);
        }
        if out.iter().any(|t| t.starts_with("text/")) && !out.iter().any(|t| t == "text/plain") {
            out.push("text/plain".into());
        }
        out
    }
}

/// `globs2` (`weight:type:pattern[:flags]`), or the older `globs`
/// (`type:pattern`, weight 50), plus the types marked `__NOGLOBS__`.
fn read_globs(mime_dir: &Path) -> (Vec<Glob>, Vec<String>) {
    let (text, v2) = match std::fs::read_to_string(mime_dir.join("globs2")) {
        Ok(t) => (t, true),
        Err(_) => match std::fs::read_to_string(mime_dir.join("globs")) {
            Ok(t) => (t, false),
            Err(_) => return (Vec::new(), Vec::new()),
        },
    };
    let mut globs = Vec::new();
    let mut cleared = Vec::new();
    for line in text.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (weight, rest) = if v2 {
            match line.split_once(':') {
                Some((w, rest)) => match w.parse::<u32>() {
                    Ok(w) => (w, rest),
                    Err(_) => continue,
                },
                None => continue,
            }
        } else {
            (50, line)
        };
        let mut parts = rest.splitn(3, ':');
        let (Some(mime), Some(pattern)) = (parts.next(), parts.next()) else { continue };
        if mime.is_empty() || pattern.is_empty() {
            continue;
        }
        if pattern == "__NOGLOBS__" {
            cleared.push(mime.to_string());
            continue;
        }
        let case_sensitive = parts.next().is_some_and(|flags| flags.split(',').any(|f| f == "cs"));
        globs.push(Glob {
            weight,
            mime: mime.to_string(),
            pattern: if case_sensitive { pattern.to_string() } else { pattern.to_lowercase() },
            case_sensitive,
        });
    }
    (globs, cleared)
}

/// `a b` pairs, one per line (`aliases`, `subclasses`).
fn read_pairs(path: &Path) -> Vec<(String, String)> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    text.lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            Some((it.next()?.to_string(), it.next()?.to_string()))
        })
        .collect()
}

/// fnmatch-style matching of a whole name: `*`, `?` and `[…]` classes
/// (`[!…]` negates, `a-z` ranges). A `[` with no closing `]` is literal.
pub(crate) fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    let (mut pi, mut ni) = (0, 0);
    // Where the last `*` was, and the name position it currently covers to.
    let mut star: Option<(usize, usize)> = None;
    while ni < n.len() {
        if pi < p.len() {
            match p[pi] {
                '*' => {
                    star = Some((pi, ni));
                    pi += 1;
                    continue;
                }
                '?' => {
                    pi += 1;
                    ni += 1;
                    continue;
                }
                '[' => {
                    if let Some((hit, next)) = match_class(&p, pi, n[ni]) {
                        if hit {
                            pi = next;
                            ni += 1;
                            continue;
                        }
                    } else if n[ni] == '[' {
                        pi += 1;
                        ni += 1;
                        continue;
                    }
                }
                c if c == n[ni] => {
                    pi += 1;
                    ni += 1;
                    continue;
                }
                _ => {}
            }
        }
        match star {
            Some((sp, sn)) => {
                pi = sp + 1;
                ni = sn + 1;
                star = Some((sp, sn + 1));
            }
            None => return false,
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

/// Whether `c` is in the class starting at `p[start]` (a `[`), and the index
/// after its `]`; None if the class never closes.
fn match_class(p: &[char], start: usize, c: char) -> Option<(bool, usize)> {
    let mut i = start + 1;
    let negate = matches!(p.get(i), Some('!' | '^'));
    if negate {
        i += 1;
    }
    let mut hit = false;
    let mut first = true;
    loop {
        let &ch = p.get(i)?;
        if ch == ']' && !first {
            return Some((hit != negate, i + 1));
        }
        first = false;
        if p.get(i + 1) == Some(&'-') && p.get(i + 2).is_some_and(|&e| e != ']') {
            if (ch..=p[i + 2]).contains(&c) {
                hit = true;
            }
            i += 3;
        } else {
            if ch == c {
                hit = true;
            }
            i += 1;
        }
    }
}

/// A file's MIME type: `inode/…` for folders and special files, else its
/// name's glob, else a guess from its first bytes (ELF, text, or binary).
pub(crate) fn mime_for_path(db: &MimeDb, path: &Path) -> String {
    let Ok(meta) = std::fs::metadata(path) else {
        return "application/octet-stream".into();
    };
    let ft = meta.file_type();
    if ft.is_dir() {
        return "inode/directory".into();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        let special = if ft.is_fifo() {
            Some("inode/fifo")
        } else if ft.is_socket() {
            Some("inode/socket")
        } else if ft.is_char_device() {
            Some("inode/chardevice")
        } else if ft.is_block_device() {
            Some("inode/blockdevice")
        } else {
            None
        };
        if let Some(t) = special {
            return t.into();
        }
    }
    if let Some(t) = path.file_name().and_then(|n| db.type_for_name(&n.to_string_lossy())) {
        return t;
    }
    sniff(path)
}

fn sniff(path: &Path) -> String {
    use std::io::Read;
    let mut head = Vec::with_capacity(4096);
    let read = super::fs_ops::open_regular(path).and_then(|f| f.take(4096).read_to_end(&mut head));
    if read.is_err() {
        return "application/octet-stream".into();
    }
    sniff_bytes(&head).into()
}

pub(crate) fn sniff_bytes(head: &[u8]) -> &'static str {
    if head.starts_with(b"\x7fELF") {
        return "application/x-executable";
    }
    if head.contains(&0) {
        return "application/octet-stream";
    }
    match std::str::from_utf8(head) {
        Ok(_) => "text/plain",
        // Cut off mid-character at the end of the sample: still text.
        Err(e) if e.error_len().is_none() => "text/plain",
        Err(_) => "application/octet-stream",
    }
}

// ---------- desktop entries ----------

/// The `[Desktop Entry]` keys Open With uses.
#[derive(Debug, Clone, Default)]
pub(crate) struct DesktopEntry {
    /// The desktop file ID: its path under `applications/`, `/` → `-`.
    pub id: String,
    pub path: PathBuf,
    pub name: String,
    pub exec: Option<String>,
    pub try_exec: Option<String>,
    /// `Path=`: the folder to start in.
    pub work_dir: Option<String>,
    pub terminal: bool,
    pub hidden: bool,
    /// `NoDisplay=true`: a handler that menus and choosers leave out, though
    /// it can still be a type's default.
    pub no_display: bool,
    pub is_app: bool,
    /// Unaliased by `AppIndex::load`.
    pub mime_types: Vec<String>,
    pub icon: Option<String>,
}

/// The locale keys to try for `Name[…]`, best first, from
/// `LC_ALL`/`LC_MESSAGES`/`LANG` (`lang_COUNTRY.ENCODING@MODIFIER`).
pub(crate) fn locale_keys(locale: &str) -> Vec<String> {
    let (rest, modifier) = match locale.split_once('@') {
        Some((r, m)) => (r, Some(m)),
        None => (locale, None),
    };
    let rest = rest.split('.').next().unwrap_or("");
    let (lang, country) = match rest.split_once('_') {
        Some((l, c)) => (l, Some(c)),
        None => (rest, None),
    };
    if lang.is_empty() || lang == "C" || lang == "POSIX" {
        return Vec::new();
    }
    let mut out = Vec::new();
    if let (Some(c), Some(m)) = (country, modifier) {
        out.push(format!("{lang}_{c}@{m}"));
    }
    if let Some(c) = country {
        out.push(format!("{lang}_{c}"));
    }
    if let Some(m) = modifier {
        out.push(format!("{lang}@{m}"));
    }
    out.push(lang.to_string());
    out
}

pub(crate) fn current_locale_keys() -> Vec<String> {
    let locale = ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))
        .unwrap_or_default();
    locale_keys(&locale)
}

/// A string value's escapes: `\s \n \t \r \\`. Others keep their backslash,
/// for `Exec`'s own quoting to read.
fn unescape_value(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('s') => out.push(' '),
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(o) => {
                out.push('\\');
                out.push(o);
            }
            None => out.push('\\'),
        }
    }
    out
}

pub(crate) fn parse_entry(id: &str, path: &Path, text: &str, locales: &[String]) -> DesktopEntry {
    let mut e = DesktopEntry { id: id.to_string(), path: path.to_path_buf(), ..Default::default() };
    let mut names: HashMap<String, String> = HashMap::new();
    let mut in_main = false;
    for line in text.lines() {
        let line = line.trim_start();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            // Only the first group; actions and the rest come after it.
            if in_main {
                break;
            }
            in_main = line.trim_end() == "[Desktop Entry]";
            continue;
        }
        if !in_main {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim_end();
        let value = unescape_value(value.trim_start());
        let truthy = value == "true" || value == "1";
        match key {
            "Type" => e.is_app = value == "Application",
            "Exec" => e.exec = Some(value),
            "TryExec" => e.try_exec = Some(value).filter(|v| !v.is_empty()),
            "Path" => e.work_dir = Some(value).filter(|v| !v.is_empty()),
            "Terminal" => e.terminal = truthy,
            "Hidden" => e.hidden = truthy,
            "NoDisplay" => e.no_display = truthy,
            "Icon" => e.icon = Some(value).filter(|v| !v.is_empty()),
            "MimeType" => {
                e.mime_types = value.split(';').map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect()
            }
            k => {
                if k == "Name" {
                    names.insert(String::new(), value);
                } else if let Some(loc) = k.strip_prefix("Name[").and_then(|r| r.strip_suffix(']')) {
                    names.insert(loc.to_string(), value);
                }
            }
        }
    }
    e.name = locales
        .iter()
        .find_map(|l| names.get(l))
        .or_else(|| names.get(""))
        .cloned()
        .unwrap_or_else(|| id.trim_end_matches(".desktop").to_string());
    e
}

/// Whether a `TryExec` or `Exec` program exists: an absolute path that's an
/// executable file, or a name found on `PATH`.
fn program_exists(prog: &str) -> bool {
    if prog.contains('/') {
        let p = Path::new(prog);
        return p.is_absolute() && is_executable_file(p);
    }
    which::which(prog).is_ok()
}

#[cfg(unix)]
fn is_executable_file(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable_file(p: &Path) -> bool {
    p.is_file()
}

impl DesktopEntry {
    /// An app that can be started: not deleted (`Hidden`), with an `Exec`
    /// and, if it names one, its `TryExec` program present.
    pub fn installed(&self) -> bool {
        self.is_app
            && !self.hidden
            && self.exec.as_deref().is_some_and(|x| !x.trim().is_empty())
            && self.try_exec.as_deref().is_none_or(program_exists)
    }
}

/// A `mimeapps.list`: type → desktop IDs, per group.
#[derive(Debug, Default)]
struct MimeAppsList {
    defaults: HashMap<String, Vec<String>>,
    added: HashMap<String, Vec<String>>,
    removed: HashMap<String, Vec<String>>,
}

fn parse_mimeapps(text: &str, db: &MimeDb) -> MimeAppsList {
    #[derive(Clone, Copy)]
    enum Group {
        Other,
        Defaults,
        Added,
        Removed,
    }
    let mut list = MimeAppsList::default();
    let mut group = Group::Other;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            group = match line {
                "[Default Applications]" => Group::Defaults,
                "[Added Associations]" => Group::Added,
                "[Removed Associations]" => Group::Removed,
                _ => Group::Other,
            };
            continue;
        }
        let g = match group {
            Group::Defaults => &mut list.defaults,
            Group::Added => &mut list.added,
            Group::Removed => &mut list.removed,
            Group::Other => continue,
        };
        let Some((mime, ids)) = line.split_once('=') else { continue };
        let ids = ids.split(';').map(str::trim).filter(|i| !i.is_empty()).map(String::from);
        g.entry(db.unalias(mime.trim()).to_string()).or_default().extend(ids);
    }
    list
}

/// The installed desktop entries and the `mimeapps.list` files.
#[derive(Debug, Default)]
pub(crate) struct AppIndex {
    /// The first entry found for each ID, most important dir first.
    entries: Vec<DesktopEntry>,
    by_id: HashMap<String, usize>,
    lists: Vec<MimeAppsList>,
}

/// `*.desktop` files under `dir` as (ID, path), sorted by ID. Subfolders
/// give `sub-name.desktop`; at most three levels, so a link loop can't
/// recurse forever.
fn desktop_files(dir: &Path) -> Vec<(String, PathBuf)> {
    fn walk(dir: &Path, prefix: &str, depth: u32, out: &mut Vec<(String, PathBuf)>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().into_owned();
            let path = ent.path();
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            if meta.is_dir() {
                if depth < 3 {
                    walk(&path, &format!("{prefix}{name}-"), depth + 1, out);
                }
            } else if meta.is_file() && name.ends_with(".desktop") {
                out.push((format!("{prefix}{name}"), path));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, "", 0, &mut out);
    out.sort();
    out
}

impl AppIndex {
    pub fn load(dirs: &XdgDirs, db: &MimeDb) -> Self {
        let locales = current_locale_keys();
        let mut idx = AppIndex::default();
        for base in dirs.data() {
            for (id, path) in desktop_files(&base.join("applications")) {
                if idx.by_id.contains_key(&id) {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(&path) else { continue };
                let mut e = parse_entry(&id, &path, &text, &locales);
                for t in e.mime_types.iter_mut() {
                    *t = db.unalias(t).to_string();
                }
                idx.by_id.insert(id, idx.entries.len());
                idx.entries.push(e);
            }
        }
        for path in dirs.mimeapps_lists() {
            if let Ok(text) = std::fs::read_to_string(&path) {
                idx.lists.push(parse_mimeapps(&text, db));
            }
        }
        idx
    }

    /// The entry for `id` if it's installed. A `Hidden` entry in a more
    /// important dir hides the same ID in the others.
    pub fn get(&self, id: &str) -> Option<&DesktopEntry> {
        self.by_id.get(id).map(|&i| &self.entries[i]).filter(|e| e.installed())
    }

    /// The installed apps for exactly `mime`, in the spec's order: each
    /// list's Added Associations, minus what it and more important lists
    /// remove, then the entries whose `MimeType=` has it.
    pub fn associations(&self, mime: &str) -> Vec<&DesktopEntry> {
        let mut out: Vec<&DesktopEntry> = Vec::new();
        let mut removed: HashSet<&str> = HashSet::new();
        for l in &self.lists {
            for id in l.added.get(mime).into_iter().flatten() {
                if removed.contains(id.as_str()) || out.iter().any(|o| &o.id == id) {
                    continue;
                }
                out.extend(self.get(id));
            }
            removed.extend(l.removed.get(mime).into_iter().flatten().map(String::as_str));
        }
        for e in &self.entries {
            let listed = e.mime_types.iter().any(|t| t == mime);
            if listed && !removed.contains(e.id.as_str()) && e.installed() && !out.iter().any(|o| o.id == e.id) {
                out.push(e);
            }
        }
        out
    }

    /// The default app for a type chain (`MimeDb::type_chain`), as GLib picks
    /// it: for each type in turn, its first installed default, else its first
    /// association.
    pub fn default_for(&self, chain: &[String]) -> Option<&DesktopEntry> {
        for t in chain {
            for l in &self.lists {
                for id in l.defaults.get(t).into_iter().flatten() {
                    if let Some(e) = self.get(id) {
                        return Some(e);
                    }
                }
            }
            if let Some(e) = self.associations(t).first() {
                return Some(e);
            }
        }
        None
    }

    /// Every app for the chain: the default first, then each type's
    /// associations, nearest type first. `NoDisplay` entries are left out
    /// unless one is the default, as GTK's chooser does.
    pub fn apps_for(&self, chain: &[String]) -> Vec<AppChoice> {
        let default = self.default_for(chain);
        let mut out: Vec<AppChoice> = Vec::new();
        let others = chain.iter().flat_map(|t| self.associations(t)).filter(|e| !e.no_display);
        for e in default.into_iter().chain(others) {
            if !out.iter().any(|a| a.id == e.id) {
                out.push(AppChoice {
                    id: e.id.clone(),
                    name: e.name.clone(),
                    is_default: default.is_some_and(|d| d.id == e.id),
                });
            }
        }
        out
    }
}

// ---------- Exec ----------

#[derive(Debug, Clone, PartialEq)]
enum Piece {
    Text(String),
    /// A field code's letter (`%f` → 'f').
    Code(char),
}

#[derive(Debug, Default)]
struct Word {
    pieces: Vec<Piece>,
    /// Some of it was in quotes, so it's an argument even if empty.
    quoted: bool,
}

impl Word {
    fn text(&mut self, c: char) {
        match self.pieces.last_mut() {
            Some(Piece::Text(t)) => t.push(c),
            _ => self.pieces.push(Piece::Text(c.to_string())),
        }
    }
}

/// Split an `Exec` value (string escapes already undone) into words, as the
/// Desktop Entry spec quotes them:
/// - words are separated by unquoted spaces, tabs and newlines;
/// - in `"…"`, `\"` `` \` `` `\$` `\\` stand for the character; other
///   backslashes are kept;
/// - `'…'` is literal (the spec reserves `'`; GLib's parser reads it so);
/// - an unquoted `\` escapes the next character;
/// - `%%` is `%`, and `%x` is field code x. A field code inside quotes is
///   refused: expanding it there would put a file name into, say, the
///   script of `sh -c "…"`.
fn split_exec(exec: &str) -> Result<Vec<Word>, String> {
    let quoted_code = || "its Exec line has a field code inside quotes, which can't be expanded safely".to_string();
    let mut words: Vec<Word> = Vec::new();
    let mut cur: Option<Word> = None;
    let mut chars = exec.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            ' ' | '\t' | '\n' => {
                if let Some(w) = cur.take() {
                    words.push(w);
                }
            }
            '"' | '\'' => {
                let w = cur.get_or_insert_with(Word::default);
                w.quoted = true;
                loop {
                    match chars.next() {
                        None => return Err(format!("its Exec line has an unclosed {c}")),
                        Some(q) if q == c => break,
                        Some('\\') if c == '"' => match chars.peek() {
                            Some(&n @ ('"' | '`' | '$' | '\\')) => {
                                chars.next();
                                w.text(n);
                            }
                            _ => w.text('\\'),
                        },
                        Some('%') => match chars.peek() {
                            Some('%') => {
                                chars.next();
                                w.text('%');
                            }
                            Some(n) if n.is_ascii_alphabetic() => return Err(quoted_code()),
                            _ => w.text('%'),
                        },
                        Some(ch) => w.text(ch),
                    }
                }
            }
            '\\' => {
                if let Some(n) = chars.next() {
                    cur.get_or_insert_with(Word::default).text(n);
                }
            }
            '%' => {
                let w = cur.get_or_insert_with(Word::default);
                match chars.next() {
                    Some('%') => w.text('%'),
                    Some(n) => w.pieces.push(Piece::Code(n)),
                    None => w.text('%'),
                }
            }
            ch => cur.get_or_insert_with(Word::default).text(ch),
        }
    }
    if let Some(w) = cur.take() {
        words.push(w);
    }
    Ok(words)
}

const FILE_CODES: [char; 4] = ['f', 'F', 'u', 'U'];

/// The argv (one per process) that start `entry` on `files`:
/// - `%f`/`%u`: a file, the path itself in both cases. With several files
///   and no `%F`/`%U`, one process per file.
/// - `%F`/`%U` as a word: one argument per file; inside a word, the first.
/// - `%i` as a word: `--icon <Icon>`; `%c`: the name; `%k`: the entry's path.
/// - `%d %D %n %N %v %m` (deprecated) and unknown codes expand to nothing,
///   and an unquoted word of nothing else is dropped.
/// - No file code at all: the files are appended, as xdg-open does.
///
/// A file only ever lands inside argv elements, so spaces, quotes, `;` or
/// `$()` in its name stay part of it.
pub(crate) fn exec_argvs(entry: &DesktopEntry, files: &[String]) -> Result<Vec<Vec<String>>, String> {
    let exec = entry.exec.as_deref().unwrap_or("");
    let words = split_exec(exec).map_err(|e| format!("{}: {}", entry.name, e))?;
    let codes: Vec<char> = words
        .iter()
        .flat_map(|w| &w.pieces)
        .filter_map(|p| match p {
            Piece::Code(c) => Some(*c),
            _ => None,
        })
        .collect();
    let first_is_code = words.first().is_some_and(|w| w.pieces.iter().any(|p| matches!(p, Piece::Code(_))));
    if words.is_empty() || first_is_code {
        return Err(format!("{}: its Exec line has no program to run", entry.name));
    }
    let many = codes.iter().any(|c| matches!(c, 'F' | 'U'));
    let one = codes.iter().any(|c| matches!(c, 'f' | 'u'));
    let groups: Vec<&[String]> = if one && !many && files.len() > 1 {
        files.chunks(1).collect()
    } else {
        vec![files]
    };
    let append = !many && !one;
    Ok(groups.into_iter().map(|g| expand_words(&words, g, entry, append)).collect())
}

fn expand_words(words: &[Word], files: &[String], entry: &DesktopEntry, append: bool) -> Vec<String> {
    let mut argv = Vec::new();
    for w in words {
        if let [Piece::Code(c)] = w.pieces.as_slice() {
            match c {
                'F' | 'U' => {
                    argv.extend(files.iter().cloned());
                    continue;
                }
                'f' | 'u' => {
                    argv.extend(files.first().cloned());
                    continue;
                }
                'i' => {
                    if let Some(icon) = &entry.icon {
                        argv.push("--icon".into());
                        argv.push(icon.clone());
                    }
                    continue;
                }
                _ => {}
            }
        }
        let mut s = String::new();
        for p in &w.pieces {
            match p {
                Piece::Text(t) => s.push_str(t),
                Piece::Code(c) if FILE_CODES.contains(c) => s.push_str(files.first().map(String::as_str).unwrap_or("")),
                Piece::Code('c') => s.push_str(&entry.name),
                Piece::Code('k') => s.push_str(&entry.path.to_string_lossy()),
                Piece::Code(_) => {}
            }
        }
        let only_codes = w.pieces.iter().all(|p| matches!(p, Piece::Code(_)));
        if s.is_empty() && only_codes && !w.quoted {
            continue;
        }
        argv.push(s);
    }
    if append {
        argv.extend(files.iter().cloned());
    }
    argv
}

/// The program an `Exec` word names: looked up on `PATH` unless it has a `/`.
#[cfg(not(windows))]
fn resolve_program(prog: &str) -> Result<PathBuf, String> {
    if prog.contains('/') {
        if program_exists(prog) {
            return Ok(PathBuf::from(prog));
        }
        return Err(format!("{prog} isn't an executable file"));
    }
    which::which(prog).map_err(|_| format!("{prog} isn't on PATH"))
}

/// Start `entry` on `files` (absolute paths), detached from the app: in its
/// own session, stdio closed, reaped when it exits. `Terminal=true` entries
/// run inside a terminal emulator. The working folder is `Path=`, else the
/// first file's folder.
#[cfg(not(windows))]
pub(crate) fn launch_entry(entry: &DesktopEntry, files: &[String]) -> Result<(), String> {
    use std::process::{Command, Stdio};
    if let Some(f) = files.iter().find(|f| !Path::new(f).is_absolute()) {
        return Err(format!("not an absolute path: {f}"));
    }
    let cwd: Option<PathBuf> = entry
        .work_dir
        .as_deref()
        .map(PathBuf::from)
        .filter(|d| d.is_dir())
        .or_else(|| files.first().and_then(|f| Path::new(f).parent()).map(Path::to_path_buf));
    for argv in exec_argvs(entry, files)? {
        let (prog, args) = argv.split_first().ok_or_else(|| format!("{}: empty Exec line", entry.name))?;
        let program = resolve_program(prog).map_err(|e| format!("{}: {}", entry.name, e))?;
        let mut cmd = if entry.terminal {
            let cwd = cwd.as_deref().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
            super::launch::linux_terminal_command(&cwd, Some((&program.to_string_lossy(), args)))?
        } else {
            let mut c = Command::new(&program);
            c.args(args);
            c
        };
        if let Some(d) = &cwd {
            cmd.current_dir(d);
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let tree = crate::proc_tree::spawn_detached(&mut cmd).map_err(|e| format!("{}: {}", entry.name, e))?;
        super::launch::reap(tree.child);
    }
    Ok(())
}

#[cfg(test)]
#[path = "xdg_apps_tests.rs"]
mod tests;

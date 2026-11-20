//! Preferences → Integration → **Use glasshouse for open and save
//! dialogs** (Linux): one switch that makes glasshouse the dialog every app
//! the standards reach shows. Turning it on:
//!
//! 1. writes the D-Bus service file that starts `glasshouse --dbus
//!    file-chooser` (`resident.rs`, `portal.rs`) in
//!    `$XDG_DATA_HOME/dbus-1/services`;
//! 2. adds `glasshouse.portal`, which tells xdg-desktop-portal there's a
//!    FileChooser backend: in `$XDG_DATA_HOME/xdg-desktop-portal/portals`
//!    on portal 1.20.1 and later; older portals read only their own data
//!    dir, which the .deb fills (otherwise Preferences shows the one root
//!    command);
//! 3. names it first for `org.freedesktop.impl.portal.FileChooser` in the
//!    portals.conf the portal reads, keeping the desktop's other choices: in
//!    place when that file is the user's, else in a copy in
//!    `$XDG_CONFIG_HOME/xdg-desktop-portal/<desktop>-portals.conf`, which
//!    comes first in the portal's search;
//! 4. writes the toolkit opt-ins (GTK 3 and Firefox, GTK 4 before 4.18, Qt)
//!    to `$XDG_CONFIG_HOME/environment.d/60-glasshouse-dialogs.conf`, read
//!    at login, and sets them in the session's service manager for apps it
//!    starts from now on;
//! 5. restarts the portal, which reads its config once, at start.
//!
//! Turning it off undoes each step; what was there before is kept in
//! `dialogs.json` beside `integration.json`. The text work is pure and
//! tested on every platform; `live` does the rest on Linux. See
//! docs/decisions/2026-11-20-file-chooser-integration.md.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::integration_xdg::{checked_path, is_ours, read_or_empty, remove_ours, write_atomic, Places, CHOOSER_NAME};

/// Marks the files and lines we write.
pub(crate) const MARK: &str = "Written by glasshouse";
pub(crate) const CHOOSER_IFACE: &str = "org.freedesktop.impl.portal.FileChooser";
/// The backend's name in portals.conf: `glasshouse.portal`'s stem.
pub(crate) const BACKEND: &str = "glasshouse";
const PORTAL_FILE: &str = "glasshouse.portal";
const SERVICE_FILE: &str = "org.freedesktop.impl.portal.desktop.glasshouse.service";
const ENV_FILE: &str = "60-glasshouse-dialogs.conf";
const PREFERRED: &str = "[preferred]";
const SETTING: &str = "Preferences → Integration → Use glasshouse for open and save dialogs";

/// An xdg-desktop-portal release.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub(crate) struct Version(pub u32, pub u32, pub u32);

impl Version {
    /// Reads `.portal` files from the user's and the system's data dirs
    /// (before: only its own data dir).
    pub const USER_PORTALS: Version = Version(1, 20, 1);
    /// Tries a portals.conf list in order (before: the first backend in
    /// file-name order that the list names).
    pub const ORDERED: Version = Version(1, 19, 0);
    /// Reads portals.conf at all.
    pub const CONFIG: Version = Version(1, 17, 0);
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.0, self.1, self.2)
    }
}

/// `xdg-desktop-portal --version`'s output: "xdg-desktop-portal 1.20.3".
pub(crate) fn parse_version(out: &str) -> Option<Version> {
    let word = out.split_whitespace().find(|w| w.starts_with(|c: char| c.is_ascii_digit()))?;
    let mut n = word.split(|c: char| !c.is_ascii_digit()).map(|p| p.parse::<u32>().ok());
    Some(Version(n.next()??, n.next().flatten().unwrap_or(0), n.next().flatten().unwrap_or(0)))
}

// ---------- where the portal looks ----------

/// The environment the portal runs in (its own, read from /proc, or ours
/// when it isn't running), and where it was installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PortalEnv {
    pub config_home: PathBuf,
    pub config_dirs: Vec<PathBuf>,
    pub data_home: PathBuf,
    pub data_dirs: Vec<PathBuf>,
    /// `XDG_CURRENT_DESKTOP` as the portal reads it: lowercased, names
    /// with other than letters, digits, `-` and `_` left out.
    pub desktops: Vec<String>,
    /// `XDG_DESKTOP_PORTAL_DIR`: when set, the portal reads only there.
    pub portal_dir: Option<PathBuf>,
    /// Its install prefix (`/usr`), for its own data and config dirs.
    pub prefix: PathBuf,
}

impl PortalEnv {
    /// From `var` (a lookup in some environment), as GLib reads it.
    pub fn from_vars(var: impl Fn(&str) -> Option<String>, prefix: &Path) -> Option<Self> {
        let get = |k: &str| var(k).filter(|v| !v.is_empty());
        let home = PathBuf::from(get("HOME")?);
        let one = |k: &str, default: PathBuf| get(k).map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or(default);
        let list = |k: &str, default: &str| -> Vec<PathBuf> {
            get(k)
                .unwrap_or_else(|| default.to_string())
                .split(':')
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .collect()
        };
        Some(PortalEnv {
            config_home: one("XDG_CONFIG_HOME", home.join(".config")),
            config_dirs: list("XDG_CONFIG_DIRS", "/etc/xdg"),
            data_home: one("XDG_DATA_HOME", home.join(".local/share")),
            data_dirs: list("XDG_DATA_DIRS", "/usr/local/share:/usr/share"),
            desktops: desktops(&get("XDG_CURRENT_DESKTOP").unwrap_or_default()),
            portal_dir: get("XDG_DESKTOP_PORTAL_DIR").map(PathBuf::from),
            prefix: prefix.to_path_buf(),
        })
    }

    fn sysconfdir(&self) -> PathBuf {
        if self.prefix == Path::new("/usr") { PathBuf::from("/etc") } else { self.prefix.join("etc") }
    }

    pub fn datadir(&self) -> PathBuf {
        self.prefix.join("share")
    }

    /// Every portals.conf the portal would read, in its order; the first
    /// with a key in `[preferred]` is the one it uses.
    pub fn conf_candidates(&self) -> Vec<PathBuf> {
        let dirs: Vec<PathBuf> = match &self.portal_dir {
            Some(d) => vec![d.clone()],
            None => {
                let sub = |d: &Path| d.join("xdg-desktop-portal");
                let mut v = vec![sub(&self.config_home)];
                v.extend(self.config_dirs.iter().map(|d| sub(d)));
                v.push(sub(&self.sysconfdir()));
                v.push(sub(&self.data_home));
                v.extend(self.data_dirs.iter().map(|d| sub(d)));
                v.push(sub(&self.datadir()));
                v
            }
        };
        let mut out = Vec::new();
        for d in dirs {
            for desk in &self.desktops {
                out.push(d.join(format!("{desk}-portals.conf")));
            }
            out.push(d.join("portals.conf"));
        }
        out
    }

    /// Where the portal reads `.portal` files, first first.
    pub fn portal_dirs(&self, version: Option<Version>) -> Vec<PathBuf> {
        let sub = |d: &Path| d.join("xdg-desktop-portal/portals");
        if let Some(d) = &self.portal_dir {
            return vec![d.clone()];
        }
        let mut v = Vec::new();
        if version.is_none_or(|v| v >= Version::USER_PORTALS) {
            v.push(sub(&self.data_home));
            v.extend(self.data_dirs.iter().map(|d| sub(d)));
        }
        v.push(sub(&self.datadir()));
        v
    }

    /// The portals.conf we write when the one in use isn't the user's.
    pub fn conf_target(&self) -> PathBuf {
        let dir = self.config_home.join("xdg-desktop-portal");
        match self.desktops.first() {
            Some(d) => dir.join(format!("{d}-portals.conf")),
            None => dir.join("portals.conf"),
        }
    }

    pub fn user_portal_file(&self) -> PathBuf {
        self.data_home.join("xdg-desktop-portal/portals").join(PORTAL_FILE)
    }

    /// The copy the .deb installs, and the one root command writes.
    pub fn system_portal_file(&self) -> PathBuf {
        self.datadir().join("xdg-desktop-portal/portals").join(PORTAL_FILE)
    }
}

/// `XDG_CURRENT_DESKTOP` as xdg-desktop-portal reads it.
pub(crate) fn desktops(value: &str) -> Vec<String> {
    value
        .split(':')
        .filter(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .map(str::to_ascii_lowercase)
        .collect()
}

// ---------- key files ----------

/// A key file's `[group]` header line and the line after its last one.
fn group_span(lines: &[&str], header: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| l.trim() == header)?;
    let end = lines[start + 1..]
        .iter()
        .position(|l| l.trim_start().starts_with('['))
        .map_or(lines.len(), |i| start + 1 + i);
    Some((start, end))
}

fn key_value(line: &str) -> Option<(&str, &str)> {
    let t = line.trim_start();
    if t.starts_with('#') {
        return None;
    }
    let (k, v) = t.split_once('=')?;
    Some((k.trim(), v.trim()))
}

/// The keys of `[header]`, in order.
pub(crate) fn group_keys(text: &str, header: &str) -> Vec<(String, String)> {
    let lines: Vec<&str> = text.lines().collect();
    let Some((start, end)) = group_span(&lines, header) else { return vec![] };
    lines[start + 1..end]
        .iter()
        .filter_map(|l| key_value(l))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn get<'a>(keys: &'a [(String, String)], key: &str) -> Option<&'a str> {
    keys.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

/// A key file list (`a;b;`).
pub(crate) fn list(value: &str) -> Vec<String> {
    value.split(';').map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect()
}

fn join_lines(lines: &[String]) -> String {
    let mut s = lines.join("\n");
    if !lines.is_empty() {
        s.push('\n');
    }
    s
}

/// `text` with `key=value` in `[preferred]` (replacing the key's line, else
/// first in the group, else in a new group at the end), and the value it
/// replaced.
pub(crate) fn set_preferred(text: &str, key: &str, value: &str) -> (String, Option<String>) {
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let line = format!("{key}={value}");
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    let Some((start, end)) = group_span(&refs, PREFERRED) else {
        if lines.last().is_some_and(|l| !l.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push(PREFERRED.to_string());
        lines.push(line);
        return (join_lines(&lines), None);
    };
    let found = (start + 1..end).find(|&i| key_value(&lines[i]).is_some_and(|(k, _)| k == key));
    match found {
        Some(i) => {
            let previous = key_value(&lines[i]).map(|(_, v)| v.to_string());
            lines[i] = line;
            (join_lines(&lines), previous)
        }
        None => {
            lines.insert(start + 1, line);
            (join_lines(&lines), None)
        }
    }
}

/// `text` with `key`'s line put back to `previous` (or removed), when its
/// list still starts with glasshouse; None when it doesn't, so a value
/// the user has since set stays.
pub(crate) fn restore_preferred(text: &str, key: &str, previous: Option<&str>) -> Option<String> {
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
    let (start, end) = group_span(&refs, PREFERRED)?;
    let i = (start + 1..end).find(|&i| key_value(&lines[i]).is_some_and(|(k, _)| k == key))?;
    let value = key_value(&lines[i]).map(|(_, v)| v.to_string()).unwrap_or_default();
    if list(&value).first().map(String::as_str) != Some(BACKEND) {
        return None;
    }
    match previous {
        Some(p) => lines[i] = format!("{key}={p}"),
        None => {
            lines.remove(i);
        }
    }
    Some(join_lines(&lines))
}

// ---------- which backend the portal picks ----------

/// One installed `.portal` file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Backend {
    /// The file's name without `.portal`, which portals.conf names.
    pub name: String,
    pub dbus_name: String,
    pub interfaces: Vec<String>,
    pub use_in: Vec<String>,
}

pub(crate) fn parse_backend(name: &str, text: &str) -> Option<Backend> {
    let keys = group_keys(text, "[portal]");
    let dbus_name = get(&keys, "DBusName")?.to_string();
    Some(Backend {
        name: name.to_string(),
        dbus_name,
        interfaces: get(&keys, "Interfaces").map(list).unwrap_or_default(),
        use_in: get(&keys, "UseIn").map(list).unwrap_or_default(),
    })
}

/// The installed backends, the first of each name winning, sorted as the
/// portal sorts them: those whose UseIn names the desktop first, then by
/// name.
pub(crate) fn load_backends(dirs: &[PathBuf], desktops: &[String]) -> Vec<Backend> {
    let mut out: Vec<Backend> = Vec::new();
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        files.sort();
        for f in files {
            let Some(name) = f.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(".portal")) else {
                continue;
            };
            if out.iter().any(|b| b.name == name) {
                continue;
            }
            if let Some(b) = std::fs::read_to_string(&f).ok().and_then(|t| parse_backend(name, &t)) {
                out.push(b);
            }
        }
    }
    sort_backends(&mut out, desktops);
    out
}

pub(crate) fn sort_backends(b: &mut [Backend], desktops: &[String]) {
    let used = |x: &Backend| x.use_in.iter().any(|u| desktops.iter().any(|d| d.eq_ignore_ascii_case(u)));
    b.sort_by(|x, y| used(y).cmp(&used(x)).then_with(|| x.name.cmp(&y.name)));
}

/// Which backend the portal uses for `iface`, by xdg-desktop-portal's
/// rules for `version`: portals.conf's key for the interface, then its
/// `default`, then UseIn, then gtk. None: no dialog backend at all.
pub(crate) fn chosen_backend<'a>(
    conf: &[(String, String)],
    backends: &'a [Backend],
    desktops: &[String],
    iface: &str,
    version: Option<Version>,
) -> Option<&'a Backend> {
    let has = |b: &&Backend| b.interfaces.iter().any(|i| i == iface);
    let ordered = version.is_none_or(|v| v >= Version::ORDERED);
    let from_list = |names: &[String]| -> Option<&'a Backend> {
        if ordered {
            names.iter().find_map(|n| {
                if n == "*" {
                    backends.iter().find(has)
                } else {
                    backends.iter().filter(has).find(|b| &b.name == n)
                }
            })
        } else {
            backends.iter().filter(has).find(|b| names.iter().any(|n| n == "*" || *n == b.name))
        }
    };
    let own = get(conf, iface).map(list);
    let default = get(conf, "default").map(list);
    match &own {
        Some(names) if names.iter().any(|n| n == "none") => return None,
        Some(names) => {
            if let Some(b) = from_list(names) {
                return Some(b);
            }
            // 1.17–1.18: the interface's own key hides default.
            if !ordered {
                return None;
            }
        }
        None => {}
    }
    if let Some(names) = &default {
        if own.is_none() && names.iter().any(|n| n == "none") {
            return None;
        }
        // `default=*` matches nothing in 1.19 and later.
        let named: Vec<String> = names.iter().filter(|n| !ordered || *n != "*").cloned().collect();
        if let Some(b) = from_list(&named) {
            return Some(b);
        }
    }
    let use_in = |b: &&Backend| b.use_in.iter().any(|u| desktops.iter().any(|d| d.eq_ignore_ascii_case(u)));
    backends
        .iter()
        .filter(has)
        .find(use_in)
        .or_else(|| backends.iter().filter(has).find(|b| b.dbus_name == "org.freedesktop.impl.portal.desktop.gtk"))
}

/// The first portals.conf in `candidates` with keys in `[preferred]`, and
/// its text.
pub(crate) fn effective_conf(candidates: &[PathBuf]) -> Option<(PathBuf, String)> {
    candidates.iter().find_map(|p| {
        let text = std::fs::read_to_string(p).ok()?;
        (!group_keys(&text, PREFERRED).is_empty()).then(|| (p.clone(), text))
    })
}

/// The FileChooser value that puts glasshouse first: before the backends
/// the file chose (its FileChooser key, else its default) on portals that
/// try them in order, alone on 1.17–1.18, which would take the first in
/// file-name order (`cosmic` before `glasshouse`).
pub(crate) fn chooser_value(conf: &[(String, String)], version: Option<Version>) -> String {
    let ordered = version.is_some_and(|v| v >= Version::ORDERED);
    if !ordered {
        return format!("{BACKEND};");
    }
    let before = get(conf, CHOOSER_IFACE).or_else(|| get(conf, "default")).map(list).unwrap_or_default();
    let mut out = vec![BACKEND.to_string()];
    // `*` stands for "any" only in an interface's own key, which this is;
    // `none` would stop the list.
    out.extend(before.into_iter().filter(|n| n != BACKEND && n != "none"));
    format!("{};", out.join(";"))
}

/// A system portals.conf copied to the user's config dir, which wins over
/// it, with a header saying why.
pub(crate) fn copied_conf(source: Option<&Path>, text: &str) -> String {
    match source {
        Some(src) => format!(
            "# {MARK}: a copy of {} with the FileChooser line added\n\
             # ({SETTING}). Turning that off removes this file, and {} counts again.\n{text}",
            src.display(),
            src.display(),
        ),
        None => format!("# {MARK} ({SETTING}).\n# Turning that off removes this file.\n{text}"),
    }
}

// ---------- the files ----------

/// `glasshouse.portal`. `system`: the .deb's copy, which says so.
pub(crate) fn portal_file(system: bool) -> String {
    let head = if system {
        "# Installed with glasshouse. It does nothing until glasshouse is named in a portals.conf,\n\
         # which Preferences → Integration → Use glasshouse for open and save dialogs does.\n"
            .to_string()
    } else {
        format!("# {MARK} ({SETTING}).\n# Turning that off removes this file.\n")
    };
    format!("{head}[portal]\nDBusName={CHOOSER_NAME}\nInterfaces={CHOOSER_IFACE};\n")
}

/// The one root command that installs `glasshouse.portal` where an older
/// portal reads it.
pub(crate) fn root_command(env: &PortalEnv) -> String {
    let body = portal_file(true).replace('\n', "\\n");
    format!("printf '{}' | sudo tee {} >/dev/null", body.replace('\'', "'\\''"), env.system_portal_file().display())
}

/// The paths a missing glasshouse cleans up: see `chooser_service`.
pub(crate) struct HealPaths<'a> {
    pub portal_file: &'a Path,
    pub service_file: &'a Path,
    pub env_file: &'a Path,
    /// Where `conf_on` puts its copy of the desktop's portals.conf.
    pub conf_copy: &'a Path,
}

/// The D-Bus service file that starts `exe --dbus file-chooser`. When
/// `exe` is gone (glasshouse uninstalled or an AppImage deleted with this
/// on), the portal would still pick glasshouse and every app's dialog
/// would fail; so instead the command removes our `glasshouse.portal`,
/// this file, the toolkit settings and our copy of portals.conf (a
/// user's own portals.conf keeps the line, which the portal skips once
/// no .portal names glasshouse), then restarts the portal, which goes
/// back to the desktop's dialog. The portal restarts only when it
/// removed one of those, so files it can't remove can't make it loop.
pub(crate) fn chooser_service(exe: &Path, heal: &HealPaths) -> Result<String, String> {
    let s = checked_path(exe)?;
    let q = |p: &Path| -> Result<String, String> {
        let p = p.to_str().ok_or_else(|| format!("path isn't UTF-8: {}", p.display()))?;
        if p.contains('\\') || p.chars().any(char::is_control) {
            return Err(format!("can't name {p:?} in a service file"));
        }
        Ok(format!("'{}'", p.replace('\'', "'\\''")))
    };
    if s.contains('\\') {
        return Err(format!("glasshouse's path has a backslash: {s}"));
    }
    let script = format!(
        "[ -x \"$1\" ] && exec \"$1\" --dbus file-chooser; \
         grep -qs \"{MARK}\" \"$4\" && rm -f \"$4\"; rm -f \"$3\"; r=; \
         if grep -qs \"{MARK}\" \"$2\"; then rm -f \"$2\"; r=1; fi; \
         if head -n 1 \"$5\" 2>/dev/null | grep -qs \"^# {MARK}\"; then rm -f \"$5\"; r=1; fi; \
         [ -n \"$r\" ] && systemctl --user try-restart xdg-desktop-portal.service; \
         exit 1"
    );
    Ok(format!(
        "# {MARK} ({SETTING}).\n\
         # Turning that off removes this file. If glasshouse is gone, the command\n\
         # below removes its portal settings instead, so dialogs go back to the desktop's.\n\
         [D-BUS Service]\n\
         Name={CHOOSER_NAME}\n\
         Exec=/bin/sh -c '{script}' glasshouse {} {} {} {} {}\n",
        q(Path::new(s))?,
        q(heal.portal_file)?,
        q(heal.service_file)?,
        q(heal.env_file)?,
        q(heal.conf_copy)?,
    ))
}

/// The toolkit opt-ins (Preferences → Advanced), each on unless turned off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Toolkits {
    pub gtk3: bool,
    pub gtk4: bool,
    pub qt: bool,
}

impl Default for Toolkits {
    fn default() -> Self {
        Toolkits { gtk3: true, gtk4: true, qt: true }
    }
}

/// What the system has that changes which variables are needed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Toolkit {
    /// The GTK 4 installed, as (minor, micro); None: none found.
    pub gtk4: Option<(u32, u32)>,
    /// The desktop is KDE Plasma, whose own Qt theme asks for the portal
    /// with a variable of its own.
    pub kde: bool,
}

impl Toolkit {
    /// GTK 4.18 and later use the portal on their own when it's there;
    /// 4.10 to 4.16 need `GDK_DEBUG=portals` (4.6 and 4.8 read
    /// `GTK_USE_PORTAL`, as GTK 3 does).
    pub fn gtk4_needs_debug(&self) -> bool {
        self.gtk4.is_none_or(|(minor, _)| (10..18).contains(&minor))
    }
}

/// One variable as environment.d writes it, with its value for the
/// service manager (no `${}` there) worked out from `current`.
#[derive(Debug, Clone)]
pub(crate) struct Var {
    pub name: &'static str,
    pub env_d: String,
    /// The value for `systemctl --user set-environment`, given the
    /// variable's value there now; None: nothing to change.
    pub session: fn(Option<&str>) -> Option<String>,
}

fn gdk_debug(current: Option<&str>) -> Option<String> {
    match current.filter(|c| !c.is_empty()) {
        Some(c) if c.split(',').any(|f| f.trim() == "portals") => None,
        Some(c) => Some(format!("{c},portals")),
        None => Some("portals".into()),
    }
}

/// The variables for the opt-ins that are on.
pub(crate) fn vars(t: Toolkits, sys: &Toolkit) -> Vec<Var> {
    let mut v = Vec::new();
    if t.gtk3 {
        v.push(Var { name: "GTK_USE_PORTAL", env_d: "1".into(), session: |_| Some("1".into()) });
    }
    if t.gtk4 && sys.gtk4_needs_debug() {
        v.push(Var { name: "GDK_DEBUG", env_d: "${GDK_DEBUG:+$GDK_DEBUG,}portals".into(), session: gdk_debug });
    }
    if t.qt {
        if sys.kde {
            v.push(Var { name: "PLASMA_INTEGRATION_USE_PORTAL", env_d: "1".into(), session: |_| Some("1".into()) });
        } else {
            v.push(Var {
                name: "QT_QPA_PLATFORMTHEME",
                env_d: "xdgdesktopportal".into(),
                session: |_| Some("xdgdesktopportal".into()),
            });
        }
    }
    v
}

/// The environment.d file for `vars`; None when there's nothing to set.
pub(crate) fn env_file(vars: &[Var]) -> Option<String> {
    if vars.is_empty() {
        return None;
    }
    let mut s = format!(
        "# {MARK} ({SETTING}).\n\
         # Read at login: apps started after that ask xdg-desktop-portal for their open and\n\
         # save dialogs, which glasshouse gives. Turning the setting off removes this file.\n"
    );
    for v in vars {
        s.push_str(&format!("{}={}\n", v.name, v.env_d));
    }
    Some(s)
}

/// Whether `env` (a process's environment) has `vars` in effect.
pub(crate) fn vars_in_effect(vars: &[Var], env: impl Fn(&str) -> Option<String>) -> bool {
    vars.iter().all(|v| match v.name {
        "GDK_DEBUG" => env(v.name).is_some_and(|c| c.split(',').any(|f| f.trim() == "portals")),
        _ => env(v.name).as_deref() == (v.session)(None).as_deref(),
    })
}

// ---------- state ----------

/// What turning on changed in a portals.conf.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfChange {
    pub path: PathBuf,
    /// The file's text before; None: we created it.
    pub original: Option<String>,
    /// What we wrote: when the file is still that, the original goes back
    /// whole; else only our line comes out.
    pub written: String,
    /// The FileChooser value it had.
    pub previous: Option<String>,
}

/// A variable we set in the service manager, and what it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EnvChange {
    pub name: String,
    pub before: Option<String>,
    pub set: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct State {
    #[serde(default)]
    pub conf: Option<ConfChange>,
    #[serde(default)]
    pub session_env: Vec<EnvChange>,
    /// Kept while off, so turning on again keeps the user's picks.
    #[serde(default)]
    pub toolkits: Toolkits,
    /// Where we wrote `glasshouse.portal`.
    #[serde(default)]
    pub portal_file: Option<PathBuf>,
}

fn state_path(p: &Places) -> PathBuf {
    p.state_dir.join("dialogs.json")
}

pub(crate) fn read_state(p: &Places) -> State {
    std::fs::read_to_string(state_path(p))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub(crate) fn write_state(p: &Places, s: &State) -> Result<(), String> {
    let body = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(&state_path(p), &body)
}

pub(crate) fn service_path(p: &Places) -> PathBuf {
    p.xdg.data_home.join("dbus-1/services").join(SERVICE_FILE)
}

pub(crate) fn env_path(p: &Places) -> PathBuf {
    p.xdg.config_home.join("environment.d").join(ENV_FILE)
}

pub(crate) fn enabled(p: &Places) -> bool {
    is_ours(&service_path(p), MARK)
}

/// The program our service file starts, when it's ours.
pub(crate) fn service_program(p: &Places) -> Option<String> {
    let text = std::fs::read_to_string(service_path(p)).ok().filter(|t| t.contains(MARK))?;
    let exec = text.lines().find_map(|l| l.strip_prefix("Exec="))?;
    let rest = exec.split_once("' glasshouse '")?.1;
    let end = rest.find("' '")?;
    Some(rest[..end].replace("'\\''", "'"))
}

// ---------- the steps ----------

/// Writes our service file.
pub(crate) fn service_on(p: &Places, exe: &Path, portal_file: &Path, conf_copy: &Path) -> Result<(), String> {
    let path = service_path(p);
    if path.exists() && !is_ours(&path, MARK) {
        return Err(format!("{} belongs to another program; remove it first", path.display()));
    }
    let heal = HealPaths { portal_file, service_file: &path, env_file: &env_path(p), conf_copy };
    write_atomic(&path, &chooser_service(exe, &heal)?)
}

pub(crate) fn service_off(p: &Places) -> Result<(), String> {
    remove_ours(&service_path(p), MARK)
}

/// Writes `glasshouse.portal` at `path` (the portal's user data dir).
pub(crate) fn portal_file_on(path: &Path) -> Result<(), String> {
    if path.exists() && !is_ours(path, MARK) {
        // Someone's own copy: it names the same backend, so it's used as is.
        return Ok(());
    }
    write_atomic(path, &portal_file(false))
}

/// Names glasshouse first for FileChooser in the portals.conf the portal
/// reads. Returns the change to record; None when it already was.
pub(crate) fn conf_on(env: &PortalEnv, version: Option<Version>) -> Result<Option<ConfChange>, String> {
    let candidates = env.conf_candidates();
    let effective = effective_conf(&candidates);
    let user_dirs = [env.config_home.join("xdg-desktop-portal")];
    let (path, original, base, source) = match &effective {
        // The user's own file: edit it in place.
        Some((path, text)) if path.parent().is_some_and(|d| user_dirs.iter().any(|u| u == d)) => {
            (path.clone(), Some(text.clone()), text.clone(), None)
        }
        other => {
            let target = env.conf_target();
            let existing = read_or_empty(&target)?;
            if let Some(t) = &existing {
                // Before every system file in the search, yet not in use:
                // it has no `[preferred]` keys. Add to it.
                let base = match other {
                    Some((src, text)) => format!("{t}{}", group_body(text, src)),
                    None => t.clone(),
                };
                (target, Some(t.clone()), base, None)
            } else {
                match other {
                    Some((src, text)) => (target, None, text.clone(), Some(src.clone())),
                    None => (target, None, String::new(), None),
                }
            }
        }
    };
    let keys = group_keys(&base, PREFERRED);
    if get(&keys, CHOOSER_IFACE).is_some_and(|v| list(v).first().map(String::as_str) == Some(BACKEND)) {
        return Ok(None);
    }
    let value = chooser_value(&keys, version);
    let (text, previous) = set_preferred(&base, CHOOSER_IFACE, &value);
    let written = if original.is_none() { copied_conf(source.as_deref(), &text) } else { text };
    write_atomic(&path, &written)?;
    Ok(Some(ConfChange { path, original, written, previous }))
}

/// `[preferred]` of `text` (from `src`), to append to a user file that has
/// none, so the desktop's other choices stay.
fn group_body(text: &str, src: &Path) -> String {
    let keys = group_keys(text, PREFERRED);
    let mut s = format!("\n# {MARK}: the choices from {} ({SETTING}).\n{PREFERRED}\n", src.display());
    for (k, v) in keys {
        s.push_str(&format!("{k}={v}\n"));
    }
    s
}

/// Undoes `c`: the original back when the file is as we left it, else
/// only our line out.
pub(crate) fn conf_off(c: &ConfChange) -> Result<(), String> {
    let Some(now) = read_or_empty(&c.path)? else { return Ok(()) };
    if now == c.written {
        return match &c.original {
            Some(o) => write_atomic(&c.path, o),
            None => std::fs::remove_file(&c.path).map_err(|e| format!("{}: {e}", c.path.display())),
        };
    }
    match restore_preferred(&now, CHOOSER_IFACE, c.previous.as_deref()) {
        Some(t) => write_atomic(&c.path, &t),
        None => Ok(()),
    }
}

/// With no record (a lost dialogs.json): takes our line out of whichever
/// user portals.conf has it.
pub(crate) fn conf_off_unrecorded(env: &PortalEnv) -> Result<bool, String> {
    let mut changed = false;
    for path in env.conf_candidates().into_iter().filter(|p| p.starts_with(&env.config_home)) {
        let Ok(Some(now)) = read_or_empty(&path) else { continue };
        let keys = group_keys(&now, PREFERRED);
        let Some(v) = get(&keys, CHOOSER_IFACE) else { continue };
        let rest: Vec<String> = list(v).into_iter().filter(|n| n != BACKEND).collect();
        if rest.len() == list(v).len() {
            continue;
        }
        let previous = (!rest.is_empty()).then(|| format!("{};", rest.join(";")));
        if let Some(t) = restore_preferred(&now, CHOOSER_IFACE, previous.as_deref()) {
            write_atomic(&path, &t)?;
            changed = true;
        }
    }
    Ok(changed)
}

/// Writes (or, with nothing to set, removes) our environment.d file.
pub(crate) fn env_on(p: &Places, vars: &[Var]) -> Result<(), String> {
    let path = env_path(p);
    if path.exists() && !is_ours(&path, MARK) {
        return Err(format!("{} wasn't written by glasshouse; leaving it", path.display()));
    }
    match env_file(vars) {
        Some(body) => write_atomic(&path, &body),
        None => remove_ours(&path, MARK),
    }
}

pub(crate) fn env_off(p: &Places) -> Result<(), String> {
    remove_ours(&env_path(p), MARK)
}

/// GTK 4's version from its library's file name in `dirs`
/// (`libgtk-4.so.1.1800.6` is 4.18.6).
pub(crate) fn gtk4_version(dirs: &[PathBuf]) -> Option<(u32, u32)> {
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        for e in rd.flatten() {
            let name = e.file_name();
            let Some(rest) = name.to_str().and_then(|n| n.strip_prefix("libgtk-4.so.1.")) else { continue };
            let mut parts = rest.split('.').map(|p| p.parse::<u32>().ok());
            if let (Some(Some(minor)), Some(Some(micro))) = (parts.next(), parts.next()) {
                return Some((minor / 100, micro));
            }
        }
    }
    None
}

/// Whether Qt's `xdgdesktopportal` platform theme is installed, for Qt 6
/// and for Qt 5 (Arch keeps Qt 5's in `qt/`).
pub(crate) fn qt_plugin_found(lib_dirs: &[PathBuf]) -> (bool, bool) {
    let has = |subdirs: &[&str]| {
        lib_dirs.iter().any(|d| {
            subdirs.iter().any(|q| d.join(q).join("plugins/platformthemes/libqxdgdesktopportal.so").is_file())
        })
    };
    (has(&["qt6"]), has(&["qt5", "qt"]))
}

/// The library dirs to look in: Debian's multiarch, then the plain ones.
pub(crate) fn lib_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(rd) = std::fs::read_dir("/usr/lib") {
        for e in rd.flatten() {
            let n = e.file_name();
            let n = n.to_string_lossy();
            if n.ends_with("-linux-gnu") || n.ends_with("-linux-musl") || n.ends_with("-linux-gnueabihf") {
                v.push(e.path());
            }
        }
    }
    v.sort();
    v.extend(["/usr/lib64", "/usr/lib"].map(PathBuf::from));
    v
}

/// The parts that ask the running system: the portal process, its
/// version and environment, the bus and the service manager.
#[cfg(target_os = "linux")]
pub(crate) mod live {
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use zbus::blocking::fdo::DBusProxy;
    use zbus::blocking::Connection;
    use zbus::names::BusName;

    use super::{parse_version, EnvChange, PortalEnv, Var, Version};
    use crate::commands::xdg_apps::XdgDirs;

    pub(crate) const PORTAL_NAME: &str = "org.freedesktop.portal.Desktop";
    const SYSTEMD: &str = "org.freedesktop.systemd1";
    const SYSTEMD_PATH: &str = "/org/freedesktop/systemd1";
    const MANAGER: &str = "org.freedesktop.systemd1.Manager";
    const UNIT: &str = "xdg-desktop-portal.service";
    const PROPS: &str = "org.freedesktop.DBus.Properties";

    /// xdg-desktop-portal as installed, and as running if it is.
    #[derive(Debug, Clone)]
    pub(crate) struct Portal {
        pub pid: Option<u32>,
        pub version: Option<Version>,
        /// Where it looks, from its own environment when it's running.
        pub env: PortalEnv,
    }

    pub(crate) fn owner_pid(conn: &Connection, name: &str) -> Option<u32> {
        let dbus = DBusProxy::new(conn).ok()?;
        let owner = dbus.get_name_owner(BusName::try_from(name).ok()?).ok()?;
        dbus.get_connection_unix_process_id(BusName::from(owner.into_inner())).ok()
    }

    fn exe_of(pid: u32) -> Option<PathBuf> {
        let p = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
        let s = p.to_str()?;
        Some(PathBuf::from(s.strip_suffix(" (deleted)").unwrap_or(s)))
    }

    fn environ(pid: u32) -> Option<HashMap<String, String>> {
        let raw = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
        Some(
            raw.split(|b| *b == 0)
                .filter_map(|kv| std::str::from_utf8(kv).ok()?.split_once('='))
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    /// The portal binary the bus starts: its service file's `Exec`, else
    /// where distributions put it.
    fn installed_exe() -> Option<PathBuf> {
        let xdg = XdgDirs::from_env()?;
        let mut dirs = vec![xdg.data_home.join("dbus-1/services")];
        dirs.extend(xdg.data_dirs.iter().map(|d| d.join("dbus-1/services")));
        for d in dirs {
            let Ok(text) = std::fs::read_to_string(d.join(format!("{PORTAL_NAME}.service"))) else { continue };
            let exec = text.lines().find_map(|l| l.trim().strip_prefix("Exec="));
            if let Some(first) = exec.and_then(|e| e.split_whitespace().next()) {
                let p = PathBuf::from(first.trim_matches(|c| c == '\'' || c == '"'));
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        ["/usr/libexec/xdg-desktop-portal", "/usr/lib/xdg-desktop-portal", "/usr/lib/xdg-desktop-portal/xdg-desktop-portal"]
            .iter()
            .map(PathBuf::from)
            .find(|p| p.is_file())
    }

    /// Its install prefix: `/usr/libexec/xdg-desktop-portal` is `/usr`'s.
    fn prefix_of(exe: &Path) -> PathBuf {
        let mut dir = exe.parent();
        while let Some(d) = dir {
            if d.join("share").is_dir() {
                return d.to_path_buf();
            }
            dir = d.parent();
        }
        PathBuf::from("/usr")
    }

    /// `exe --version`, given two seconds.
    fn version_of(exe: &Path) -> Option<Version> {
        use std::process::{Command, Stdio};
        let mut child = Command::new(exe)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let until = Instant::now() + Duration::from_secs(2);
        loop {
            if child.try_wait().ok()?.is_some() {
                break;
            }
            if Instant::now() >= until {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let mut out = String::new();
        std::io::Read::read_to_string(&mut child.stdout.take()?, &mut out).ok()?;
        parse_version(&out)
    }

    fn is_portal(exe: &Path) -> bool {
        exe.file_name().is_some_and(|n| n == "xdg-desktop-portal")
    }

    /// The portal, None when it isn't installed.
    pub(crate) fn find(conn: Option<&Connection>) -> Option<Portal> {
        let running = conn
            .and_then(|c| owner_pid(c, PORTAL_NAME))
            .and_then(|pid| Some((pid, exe_of(pid).filter(|e| is_portal(e))?)));
        let (pid, exe) = match running {
            Some((pid, exe)) => (Some(pid), exe),
            None => (None, installed_exe()?),
        };
        let environ = pid.and_then(environ);
        let prefix = prefix_of(&exe);
        let env = match &environ {
            Some(vars) => PortalEnv::from_vars(|k| vars.get(k).cloned(), &prefix),
            None => PortalEnv::from_vars(|k| std::env::var(k).ok(), &prefix),
        }?;
        Some(Portal { pid, version: version_of(&exe), env })
    }

    fn has_owner(conn: &Connection, name: &str) -> bool {
        DBusProxy::new(conn)
            .and_then(|d| Ok(d.name_has_owner(BusName::try_from(name).map_err(zbus::Error::from)?)?))
            .unwrap_or(false)
    }

    /// The session's systemd, when it's on this bus (not on a private one).
    fn systemd(conn: &Connection) -> Option<&Connection> {
        has_owner(conn, SYSTEMD).then_some(conn)
    }

    fn portal_unit_pid(conn: &Connection) -> Option<u32> {
        let sd = systemd(conn)?;
        let unit: zbus::zvariant::OwnedObjectPath =
            sd.call_method(Some(SYSTEMD), SYSTEMD_PATH, Some(MANAGER), "GetUnit", &(UNIT,)).ok()?.body().deserialize().ok()?;
        let v: zbus::zvariant::OwnedValue = sd
            .call_method(Some(SYSTEMD), unit.as_str(), Some(PROPS), "Get", &("org.freedesktop.systemd1.Service", "MainPID"))
            .ok()?
            .body()
            .deserialize()
            .ok()?;
        u32::try_from(v).ok().filter(|p| *p != 0)
    }

    fn wait_for(what: impl Fn() -> bool, limit: Duration) -> bool {
        let until = Instant::now() + limit;
        while Instant::now() < until {
            if what() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        what()
    }

    /// Restarts the running portal so it reads its files again: through
    /// systemd when it runs the portal, else by stopping the process (only
    /// if it is xdg-desktop-portal) and asking the bus to start it. A
    /// portal that isn't running reads them when it starts.
    pub(crate) fn restart(conn: &Connection) -> Result<(), String> {
        let Some(pid) = owner_pid(conn, PORTAL_NAME) else { return Ok(()) };
        if portal_unit_pid(conn) == Some(pid) {
            conn.call_method(Some(SYSTEMD), SYSTEMD_PATH, Some(MANAGER), "RestartUnit", &(UNIT, "replace"))
                .map_err(|e| format!("restarting {UNIT}: {e}"))?;
        } else {
            if !exe_of(pid).is_some_and(|e| is_portal(&e)) {
                return Err(format!("{PORTAL_NAME} is held by pid {pid}, which isn't xdg-desktop-portal; restart it yourself"));
            }
            // SAFETY: kill(2) with a pid read from the bus; no memory involved.
            if unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) } != 0 {
                return Err(format!("stopping xdg-desktop-portal (pid {pid}): {}", std::io::Error::last_os_error()));
            }
            wait_for(|| owner_pid(conn, PORTAL_NAME) != Some(pid), Duration::from_secs(3));
            if let Ok(d) = DBusProxy::new(conn) {
                let _ = d.start_service_by_name(PORTAL_NAME.try_into().map_err(|e: zbus::names::Error| e.to_string())?, 0);
            }
        }
        if wait_for(|| owner_pid(conn, PORTAL_NAME).is_some_and(|p| p != pid), Duration::from_secs(5)) {
            Ok(())
        } else {
            Err("xdg-desktop-portal didn't come back; it starts again when an app asks for it".into())
        }
    }

    /// When `pid` started, from /proc.
    pub(crate) fn started_at(pid: u32) -> Option<std::time::SystemTime> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        // Fields after the command, which is in parentheses: starttime is
        // the 22nd field, the 20th after it.
        let ticks: u64 = stat.rsplit_once(')')?.1.split_whitespace().nth(19)?.parse().ok()?;
        let boot: u64 = std::fs::read_to_string("/proc/stat")
            .ok()?
            .lines()
            .find_map(|l| l.strip_prefix("btime ")?.trim().parse().ok())?;
        // SAFETY: sysconf has no preconditions.
        let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
        let hz = u64::try_from(hz).ok().filter(|h| *h > 0)?;
        Some(std::time::UNIX_EPOCH + Duration::from_secs(boot) + Duration::from_millis(ticks * 1000 / hz))
    }

    /// The service manager's environment, None when there's no manager on
    /// this bus.
    pub(crate) fn manager_env(conn: &Connection) -> Option<HashMap<String, String>> {
        let sd = systemd(conn)?;
        let v: zbus::zvariant::OwnedValue =
            sd.call_method(Some(SYSTEMD), SYSTEMD_PATH, Some(PROPS), "Get", &(MANAGER, "Environment")).ok()?.body().deserialize().ok()?;
        let list = Vec::<String>::try_from(v).ok()?;
        Some(list.into_iter().filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), v.to_string()))).collect())
    }

    fn manager_call(conn: &Connection, method: &str, args: &[String]) -> Result<(), String> {
        conn.call_method(Some(SYSTEMD), SYSTEMD_PATH, Some(MANAGER), method, &(args,))
            .map(|_| ())
            .map_err(|e| format!("{method}: {e}"))
    }

    /// Sets `vars` in the service manager, so apps it starts from now on
    /// get them; returns what changed, to undo. Nothing without a manager.
    pub(crate) fn session_env_on(conn: &Connection, vars: &[Var]) -> Result<Vec<EnvChange>, String> {
        let Some(now) = manager_env(conn) else { return Ok(vec![]) };
        let mut changes = Vec::new();
        let mut set = Vec::new();
        for v in vars {
            let before = now.get(v.name).cloned();
            let Some(value) = (v.session)(before.as_deref()) else { continue };
            if before.as_deref() == Some(value.as_str()) {
                continue;
            }
            set.push(format!("{}={value}", v.name));
            changes.push(EnvChange { name: v.name.to_string(), before, set: value });
        }
        if !set.is_empty() {
            manager_call(conn, "SetEnvironment", &set)?;
        }
        Ok(changes)
    }

    /// Puts back what `changes` set, where it's still what we set. Returns
    /// the ones that couldn't be.
    pub(crate) fn session_env_off(conn: &Connection, changes: Vec<EnvChange>) -> Vec<EnvChange> {
        let Some(now) = manager_env(conn) else { return if has_owner(conn, SYSTEMD) { changes } else { vec![] } };
        let mut left = Vec::new();
        for c in changes {
            if now.get(&c.name) != Some(&c.set) {
                continue;
            }
            let done = match &c.before {
                Some(b) => manager_call(conn, "SetEnvironment", &[format!("{}={b}", c.name)]),
                None => manager_call(conn, "UnsetEnvironment", std::slice::from_ref(&c.name)),
            };
            if done.is_err() {
                left.push(c);
            }
        }
        left
    }
}

// The portal is Linux's; the tests use Unix paths and /bin/sh.
#[cfg(all(test, unix))]
#[path = "integration_portal_tests.rs"]
mod tests;

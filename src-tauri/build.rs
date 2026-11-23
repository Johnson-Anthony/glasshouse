use std::collections::BTreeSet;

fn main() {
    check_command_permissions();
    // The app manifest reads permissions/*.toml. Once it defines any
    // permission, Tauri ACL-checks app commands too, not just plugin ones.
    let mut attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new());
    if windows_msvc() {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        embed_windows_manifest();
    }
    if let Err(error) = tauri_build::try_build(attributes) {
        println!("{error:#}");
        std::process::exit(1);
    }
}

fn windows_msvc() -> bool {
    std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

/// Embed the manifest (Common Controls v6, long paths, Windows 10 and 11 as
/// the supported OS: windows/app-manifest.xml) through the linker, so every exe
/// gets it, the unit-test exe included. tauri-build's own manifest is a
/// resource linked into the app's binary alone, and a test exe that imports
/// a comctl32 v6 function fails to load without it
/// (STATUS_ENTRYPOINT_NOT_FOUND; Windows CI's first run of one process with
/// many windows, 14fbcec).
fn embed_windows_manifest() {
    let manifest = std::env::current_dir()
        .expect("build.rs: current dir")
        .join("windows")
        .join("app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}

/// Fail the build unless the commands registered in `generate_handler!` in
/// src/lib.rs and the commands allowed in permissions/*.toml are the same set.
/// A registered command that no permission allows is rejected at runtime, and
/// most frontend wrappers swallow that error, so it would just look broken.
fn check_command_permissions() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=permissions");

    let lib = std::fs::read_to_string("src/lib.rs").expect("read src/lib.rs");
    let registered = registered_commands(&lib);
    assert!(!registered.is_empty(), "build.rs: no generate_handler! list in src/lib.rs");

    let mut allowed = BTreeSet::new();
    for entry in std::fs::read_dir("permissions").expect("read permissions/") {
        let path = entry.expect("read permissions/").path();
        if path.extension() != Some(std::ffi::OsStr::new("toml")) {
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("read permission file");
        let doc: toml::Table = toml::from_str(&text)
            .unwrap_or_else(|e| panic!("build.rs: {}: {e}", path.display()));
        let permissions = doc.get("permission").and_then(|p| p.as_array());
        for perm in permissions.into_iter().flatten() {
            let cmds = perm
                .get("commands")
                .and_then(|c| c.get("allow"))
                .and_then(|a| a.as_array());
            for cmd in cmds.into_iter().flatten() {
                allowed.insert(cmd.as_str().expect("command name is a string").to_string());
            }
        }
    }

    let missing: Vec<_> = registered.difference(&allowed).collect();
    let unknown: Vec<_> = allowed.difference(&registered).collect();
    if !missing.is_empty() || !unknown.is_empty() {
        let mut msg = String::from("build.rs: app command permissions are out of date.\n");
        if !missing.is_empty() {
            msg += &format!(
                "  Registered in src/lib.rs but allowed by no permission in permissions/: {missing:?}\n  \
                 Add each to the fitting group in permissions/app.toml.\n"
            );
        }
        if !unknown.is_empty() {
            msg += &format!(
                "  Allowed in permissions/ but not registered in src/lib.rs: {unknown:?}\n"
            );
        }
        panic!("{msg}");
    }
}

/// Command names (last path segment) in the `generate_handler![...]` list.
fn registered_commands(lib: &str) -> BTreeSet<String> {
    let Some(start) = lib.find("generate_handler![") else {
        return BTreeSet::new();
    };
    let body = &lib[start + "generate_handler![".len()..];
    let body = &body[..body.find(']').expect("generate_handler! list ends with ]")];
    body.lines()
        .map(|line| line.split("//").next().unwrap_or(""))
        .flat_map(|line| line.split(','))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.rsplit("::").next().unwrap_or(s).to_string())
        .collect()
}

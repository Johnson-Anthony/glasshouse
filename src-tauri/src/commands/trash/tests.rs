use super::*;

fn item(id: &str, original: &str, deleted: i64) -> Item {
    Item { id: id.into(), original: PathBuf::from(original), deleted }
}

fn key(original: &str, from: i64, to: i64, id: Option<&str>) -> TrashKey {
    TrashKey { original: original.into(), from, to, id: id.map(str::to_string) }
}

fn reasons(problems: &[TrashProblem]) -> Vec<(&str, &str)> {
    problems.iter().map(|p| (p.path.as_str(), p.reason.as_str())).collect()
}

#[test]
fn a_key_picks_the_one_item_deleted_in_its_window() {
    let items = [
        item("a.1", "/d/a.txt", 100), // an older trashing of the same path
        item("a.2", "/d/a.txt", 205),
        item("b", "/d/b.txt", 205),
    ];
    let (picked, problems) = pick(&items, &[key("/d/a.txt", 204, 206, None)]);
    assert_eq!(picked, [1]);
    assert!(problems.is_empty());
    // A second of slack either side of the window.
    assert_eq!(pick(&items, &[key("/d/a.txt", 206, 207, None)]).0, [1]);
    assert_eq!(pick(&items, &[key("/d/a.txt", 101, 101, None)]).0, [0]);
}

#[test]
fn none_or_several_matches_refuse() {
    let items = [item("a.1", "/d/a.txt", 200), item("a.2", "/d/a.txt", 201)];
    let (picked, problems) = pick(&items, &[key("/d/a.txt", 300, 301, None), key("/d/a.txt", 200, 201, None)]);
    assert!(picked.is_empty());
    assert_eq!(
        reasons(&problems),
        [("/d/a.txt", "isn't in the trash any more"), ("/d/a.txt", "more than one item in the trash matches it")]
    );
    // The view's id tells them apart.
    assert_eq!(pick(&items, &[key("/d/a.txt", 200, 201, Some("a.2"))]).0, [1]);
}

#[test]
fn an_id_alone_is_not_enough() {
    // On Linux an id is reused once its item has left the trash: same id,
    // another deletion.
    let items = [item("x.trashinfo", "/d/x", 500)];
    let (picked, problems) = pick(&items, &[key("/d/x", 100, 101, Some("x.trashinfo"))]);
    assert!(picked.is_empty());
    assert_eq!(problems.len(), 1);
}

#[test]
fn a_repeated_key_picks_its_item_once() {
    let items = [item("a", "/d/a", 10)];
    let k = key("/d/a", 10, 10, None);
    assert_eq!(pick(&items, &[k.clone(), k]).0, [0]);
}

#[test]
fn restore_refuses_a_taken_path_and_a_second_item_for_one_path() {
    let items = [item("a.2", "/d/a", 20), item("a.1", "/d/a", 10), item("b", "/d/b", 10), item("c", "/d/c", 10)];
    let (ok, problems) = restorable(&items, vec![0, 1, 2, 3], |p| p == Path::new("/d/c"));
    assert_eq!(ok, [0, 2]);
    assert_eq!(
        reasons(&problems),
        [
            ("/d/a", "another item being restored goes back to the same place"),
            ("/d/c", "something with that name is there now"),
        ]
    );
}

#[test]
fn the_original_path_is_the_canonical_folder_plus_the_name() {
    let d = crate::commands::testing::Scratch::new("trash-original");
    std::fs::create_dir(d.join("real")).unwrap();
    let got = trash_original(&d.join("real").join("..").join("real").join("f.txt")).unwrap();
    assert_eq!(got, dunce::canonicalize(d.join("real")).unwrap().join("f.txt"));
    assert!(trash_original(Path::new("f.txt")).is_err());
}

// Round trips through a real freedesktop trash. The crate finds the trash
// through XDG_DATA_HOME, and a test must never touch the user's, so (as in
// fs_ops_tests' move_to_trash test) the work happens in a child copy of this
// test binary with its own environment.
#[cfg(target_os = "linux")]
mod real {
    use super::*;
    use crate::commands::testing::{put, read, Scratch};

    /// Names the parent's scratch folder; the child tests do nothing without it.
    const ROOT: &str = "GLASSHOUSE_TRASH_RESTORE_ROOT";

    #[test]
    fn round_trips_through_a_private_trash() {
        let d = Scratch::new("trash-restore");
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["commands::trash::tests::real::child_", "--ignored", "--test-threads=1"])
            .env("XDG_DATA_HOME", d.join("data"))
            .env(ROOT, d.path())
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(out.status.success(), "{}{}", stdout, stderr);
        assert!(stdout.contains("3 passed"), "the child tests didn't all run: {}", stdout);
    }

    /// A fresh folder for one child test, next to the private trash. `None`
    /// outside the parent's child process.
    fn scratch(name: &str) -> Option<PathBuf> {
        let root = PathBuf::from(std::env::var_os(ROOT)?);
        assert_eq!(std::env::var_os("XDG_DATA_HOME").map(PathBuf::from), Some(root.join("data")));
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        Some(dir)
    }

    fn key_of(t: &Trashed) -> TrashKey {
        TrashKey { original: t.original.clone(), from: t.from, to: t.to, id: None }
    }

    #[test]
    #[ignore = "run in a child process by round_trips_through_a_private_trash"]
    fn child_a_trashed_file_is_listed_and_restored() {
        let Some(d) = scratch("restore") else { return };
        let f = d.join("note.txt");
        put(&f, "kept");
        let t = trash_path(&f).unwrap();
        assert!(!f.exists());
        assert_eq!(Path::new(&t.original), dunce::canonicalize(&d).unwrap().join("note.txt"));

        let listed: Vec<TrashEntry> = trash_list().unwrap().into_iter().filter(|e| e.original == t.original).collect();
        assert_eq!(listed.len(), 1);
        assert!((t.from..=t.to).contains(&listed[0].deleted));
        assert_eq!(listed[0].size, Some(4));

        let res = trash_restore(vec![key_of(&t)], true).unwrap();
        assert_eq!(res, TrashResult { done: vec![t.original.clone()], problems: vec![] });
        assert_eq!(read(&f), "kept");
        // It's gone from the trash, so a second restore refuses.
        let again = trash_restore(vec![key_of(&t)], true).unwrap();
        assert_eq!(reasons(&again.problems), [(t.original.as_str(), "isn't in the trash any more")]);
    }

    #[test]
    #[ignore = "run in a child process by round_trips_through_a_private_trash"]
    fn child_a_taken_path_refuses_and_purge_removes_the_item() {
        let Some(d) = scratch("taken") else { return };
        let f = d.join("a.txt");
        put(&f, "old");
        let t = trash_path(&f).unwrap();
        put(&f, "new");

        let res = trash_restore(vec![key_of(&t)], true).unwrap();
        assert!(res.done.is_empty());
        assert_eq!(reasons(&res.problems), [(t.original.as_str(), "something with that name is there now")]);
        assert_eq!(read(&f), "new");

        let purged = trash_purge(vec![key_of(&t)]).unwrap();
        assert_eq!(purged.done, std::slice::from_ref(&t.original));
        assert!(trash_list().unwrap().iter().all(|e| e.original != t.original));
    }

    #[test]
    #[ignore = "run in a child process by round_trips_through_a_private_trash"]
    fn child_all_or_nothing_restores_nothing_when_one_is_refused() {
        let Some(d) = scratch("all") else { return };
        let (a, b) = (d.join("a"), d.join("b"));
        put(&a, "a");
        put(&b, "b");
        let ta = trash_path(&a).unwrap();
        let tb = trash_path(&b).unwrap();
        put(&b, "taken");

        let res = trash_restore(vec![key_of(&ta), key_of(&tb)], true).unwrap();
        assert!(res.done.is_empty());
        assert!(!a.exists());
        // Without all_or_nothing, the free one goes back.
        let res = trash_restore(vec![key_of(&ta), key_of(&tb)], false).unwrap();
        assert_eq!(res.done, std::slice::from_ref(&ta.original));
        assert_eq!(read(&a), "a");
        trash_purge(vec![key_of(&tb)]).unwrap();
    }
}

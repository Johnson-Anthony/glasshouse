//! The arguments each Linux terminal emulator gets.

#[cfg(not(windows))]
use super::*;

#[cfg(not(windows))]
mod linux {
    use super::*;

    /// (program, args, cwd) of the command for `term`.
    fn built(term: &str, cwd: &str, run: Option<(&str, &[String])>) -> (String, Vec<String>, Option<String>) {
        let cmd = terminal_command_for(term, cwd, run);
        (
            cmd.get_program().to_string_lossy().into_owned(),
            cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect(),
            cmd.get_current_dir().map(|d| d.to_string_lossy().into_owned()),
        )
    }

    fn args(term: &str, cwd: &str, run: Option<(&str, &[String])>) -> Vec<String> {
        built(term, cwd, run).1
    }

    const CWD: &str = "/home/me/my project";

    #[test]
    fn each_terminal_gets_its_own_folder_flag() {
        assert_eq!(args("kitty", CWD, None), ["--directory", CWD]);
        assert_eq!(args("alacritty", CWD, None), ["--working-directory", CWD]);
        assert_eq!(args("foot", CWD, None), ["--working-directory", CWD]);
        assert_eq!(args("konsole", CWD, None), ["--workdir", CWD]);
        assert_eq!(args("gnome-terminal", CWD, None), [format!("--working-directory={}", CWD)]);
        assert_eq!(args("xfce4-terminal", CWD, None), [format!("--working-directory={}", CWD)]);
        assert_eq!(args("wezterm", CWD, None), ["start", "--cwd", CWD]);
        // The rest only inherit the process's folder.
        assert_eq!(args("xterm", CWD, None), Vec::<String>::new());
        assert_eq!(args("x-terminal-emulator", CWD, None), Vec::<String>::new());
    }

    #[test]
    fn every_terminal_starts_in_the_folder() {
        for term in ["kitty", "alacritty", "foot", "wezterm", "konsole", "gnome-terminal", "xterm"] {
            assert_eq!(built(term, CWD, None).2.as_deref(), Some(CWD), "{}", term);
        }
    }

    #[test]
    fn each_terminal_gets_its_own_way_to_run_a_program() {
        let a = vec!["-p".to_string(), "22".to_string(), "host".to_string()];
        let run = Some(("ssh", a.as_slice()));
        let tail = ["ssh", "-p", "22", "host"];
        let with = |pre: &[&str]| -> Vec<String> {
            pre.iter().chain(tail.iter()).map(|s| s.to_string()).collect()
        };
        assert_eq!(args("kitty", "", run), with(&[]));
        assert_eq!(args("foot", "", run), with(&[]));
        assert_eq!(args("gnome-terminal", "", run), with(&["--"]));
        assert_eq!(args("xfce4-terminal", "", run), with(&["-x"]));
        assert_eq!(args("wezterm", "", run), with(&["start", "--"]));
        assert_eq!(args("alacritty", "", run), with(&["-e"]));
        assert_eq!(args("konsole", "", run), with(&["-e"]));
        assert_eq!(args("xterm", "", run), with(&["-e"]));
        // Folder flags come first.
        assert_eq!(args("wezterm", CWD, run), with(&["start", "--cwd", CWD, "--"]));
        assert_eq!(args("kitty", CWD, run), with(&["--directory", CWD]));
    }

    #[test]
    fn a_path_from_terminal_env_is_matched_by_its_name() {
        let (program, a, _) = built("/opt/kitty/bin/kitty", CWD, None);
        assert_eq!(program, "/opt/kitty/bin/kitty");
        assert_eq!(a, ["--directory", CWD]);
    }

    #[test]
    fn no_folder_means_no_folder_flags() {
        assert_eq!(built("kitty", "", None), ("kitty".into(), vec![], None));
        assert_eq!(args("wezterm", "", None), ["start"]);
    }
}

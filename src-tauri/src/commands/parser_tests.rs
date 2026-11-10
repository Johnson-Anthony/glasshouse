//! ssh config, /proc/self/mounts and /proc/net/dev parsing, and the
//! arguments each Linux terminal emulator gets.

use super::*;

#[test]
fn ssh_hosts_lists_named_hosts_in_order() {
    let config = "\
# personal
Host alpha beta
    HostName alpha.example.com
    User me
host\tgamma
HOST delta *.internal w?ld
Hostname not-a-host
  Host   alpha   epsilon
Match host zeta
";
    assert_eq!(parse_ssh_hosts(config), ["alpha", "beta", "gamma", "delta", "epsilon"]);
}

#[test]
fn ssh_hosts_of_an_empty_or_wildcard_config_is_empty() {
    assert!(parse_ssh_hosts("").is_empty());
    assert!(parse_ssh_hosts("Host *\n  ServerAliveInterval 30\n").is_empty());
}

// ssh_config(5): a keyword and its arguments are separated by whitespace,
// or by optional whitespace and exactly one `=`.
#[test]
fn ssh_hosts_accepts_an_equals_sign_after_the_keyword() {
    let config = "\
Host=alpha
host = beta gamma
HOST =delta
Host\t=\tepsilon
Host= zeta
";
    assert_eq!(parse_ssh_hosts(config), ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
}

#[test]
fn ssh_hosts_skips_other_keywords_and_malformed_lines() {
    let config = "\
Hostname=not-a-host
HostKeyAlias = nope
Host==twice
Host = =twice
Host
Host =
Match host=zeta
";
    assert!(parse_ssh_hosts(config).is_empty(), "{:?}", parse_ssh_hosts(config));
}

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

    const MOUNTS: &str = "\
sysfs /sys sysfs rw,nosuid 0 0
/dev/nvme0n1p2 / ext4 rw,relatime 0 0
tmpfs /tmp tmpfs rw 0 0
/dev/sda1 /mnt/data btrfs rw 0 0
/dev/sdb1 /mnt/my\\040disk vfat rw 0 0
server:/export /mnt/database nfs4 rw 0 0
garbage
";

    #[test]
    fn fs_type_takes_the_longest_mount_point_holding_the_path() {
        assert_eq!(fs_type_for(MOUNTS, "/home/me"), "ext4");
        assert_eq!(fs_type_for(MOUNTS, "/"), "ext4");
        assert_eq!(fs_type_for(MOUNTS, "/tmp"), "tmpfs");
        assert_eq!(fs_type_for(MOUNTS, "/tmp/a/b"), "tmpfs");
        assert_eq!(fs_type_for(MOUNTS, "/mnt/data/x"), "btrfs");
        assert_eq!(fs_type_for(MOUNTS, "/mnt/database/x"), "nfs4");
        assert_eq!(fs_type_for(MOUNTS, "/sys/class"), "sysfs");
    }

    #[test]
    fn fs_type_matches_whole_path_components_only() {
        assert_eq!(fs_type_for(MOUNTS, "/tmpfiles"), "ext4");
        assert_eq!(fs_type_for(MOUNTS, "/mnt/datab"), "ext4");
    }

    #[test]
    fn fs_type_decodes_spaces_in_mount_points() {
        assert_eq!(fs_type_for(MOUNTS, "/mnt/my disk/photo.jpg"), "vfat");
    }

    // A later mount on the same mount point hides the earlier one.
    #[test]
    fn fs_type_takes_the_last_of_mounts_stacked_on_one_point() {
        // As on this machine: systemd's autofs, then binfmt_misc over it.
        let mounts = "\
/dev/root / ext4 rw 0 0
systemd-1 /proc/sys/fs/binfmt_misc autofs rw 0 0
binfmt_misc /proc/sys/fs/binfmt_misc binfmt_misc rw 0 0
";
        assert_eq!(fs_type_for(mounts, "/proc/sys/fs/binfmt_misc"), "binfmt_misc");
        assert_eq!(fs_type_for(mounts, "/proc/sys/fs/binfmt_misc/status"), "binfmt_misc");
        // Older kernels list the initial rootfs before the real root.
        let mounts = "rootfs / rootfs rw 0 0\n/dev/sda2 / ext4 rw 0 0\n";
        assert_eq!(fs_type_for(mounts, "/home/me"), "ext4");
    }

    #[test]
    fn fs_type_prefers_the_deepest_mount_even_when_it_is_listed_first() {
        // Mounts moved into the new root at boot are listed before `/`.
        let mounts = "proc /proc proc rw 0 0\nrun /run tmpfs rw 0 0\n/dev/root / ext4 rw 0 0\n";
        assert_eq!(fs_type_for(mounts, "/proc/self"), "proc");
        assert_eq!(fs_type_for(mounts, "/run/user"), "tmpfs");
        assert_eq!(fs_type_for(mounts, "/home"), "ext4");
    }

    #[test]
    fn fs_type_without_a_matching_mount_is_empty() {
        assert_eq!(fs_type_for("", "/home"), "");
        assert_eq!(fs_type_for("tmpfs /tmp tmpfs rw 0 0\n", "/home"), "");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn fs_type_reads_this_machines_mounts() {
        assert_eq!(path_fs_type("/proc".into()).unwrap(), "proc");
        assert!(!path_fs_type("/".into()).unwrap().is_empty());
    }

    const NET_DEV: &str = "\
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0
  eth0: 200 2 0 0 0 0 0 0 300 3 0 0 0 0 0 0
 wlan0:5000 5 0 0 0 0 0 0 7000 7 0 0 0 0 0 0
 short: 1 2 3
";

    #[test]
    fn net_dev_sums_rx_and_tx_bytes_without_loopback() {
        assert_eq!(parse_net_dev(NET_DEV), (5200, 7300));
    }

    #[test]
    fn net_dev_ignores_headers_and_saturates() {
        assert_eq!(parse_net_dev(""), (0, 0));
        // The two header lines are skipped even if they look like data.
        let headers_only = "a: 1 0 0 0 0 0 0 0 1\nb: 1 0 0 0 0 0 0 0 1\n";
        assert_eq!(parse_net_dev(headers_only), (0, 0));
        let max = u64::MAX;
        let huge = format!("h\nh\n a: {max} 0 0 0 0 0 0 0 {max}\n b: 5 0 0 0 0 0 0 0 5\n");
        assert_eq!(parse_net_dev(&huge), (max, max));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn net_dev_reads_this_machine() {
        assert!(sample_net_octets().is_ok());
    }
}

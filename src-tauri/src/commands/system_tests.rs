//! /proc/self/mounts and /proc/net/dev parsing.

#[cfg(not(windows))]
use super::*;

#[cfg(not(windows))]
mod linux {
    use super::*;

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

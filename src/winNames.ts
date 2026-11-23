// Windows' rules for one file or folder name, as pure functions. They apply
// on Windows, on Linux inside a FAT, exFAT or SMB folder (names.ts), and
// they decide whether a verbatim path has a plain form (paths.ts). The
// backend's copy is src-tauri/src/winpath.rs.

/** `name` is one of DOS's device names, which Windows opens as the device
 *  wherever the name appears: `CON`, `NUL.txt`, `com1`, `LPT¹`. What counts
 *  is the part before the first dot, without trailing spaces. */
export function isDeviceName(name: string): boolean {
  const stem = name.split(".")[0].replace(/ +$/, "").toUpperCase();
  return /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/.test(stem);
}

/** Why Windows, or a file system with its rules, won't take `name` as it is
 *  written, or null. `where` ends the sentence: "on Windows", "on this
 *  drive". Separators are the caller's to check.
 *  - `a:b` would make a hidden stream of file `a`, and `* ? " < > |` are
 *    refused;
 *  - a trailing dot or space is dropped silently, so the item gets another
 *    name than the one typed;
 *  - a device name fails with an error about a device. */
export function windowsNameProblem(name: string, where: string): string | null {
  const bad = /[<>:"|?*\\\u0000-\u001f]/.exec(name);
  if (bad) {
    return bad[0] < " "
      ? `a name can't contain control characters ${where}`
      : `a name can't contain ${bad[0]} ${where}`;
  }
  if (/[. ]$/.test(name)) return `a name can't end with a dot or a space ${where}`;
  if (isDeviceName(name)) {
    return `"${name.split(".")[0].trimEnd()}" is a reserved name ${where}`;
  }
  return null;
}

/** A Linux file system type (`path_fs_type`) that has Windows' name rules:
 *  FAT, exFAT and SMB shares. NTFS mounted on Linux takes any name. */
export function hasWindowsNames(fsType: string): boolean {
  return /^(?:vfat|msdos|exfat|fuse\.exfat|cifs|smb3|smbfs)$/i.test(fsType.trim());
}

# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue, pull request or discussion.

1. Go to the repository's [Security tab](https://github.com/Johnson-Anthony/glasshouse/security).
2. Choose **Report a vulnerability** ([direct link](https://github.com/Johnson-Anthony/glasshouse/security/advisories/new)).
3. Describe the problem, the version (Help → About), your OS, and the steps or file that trigger it.

Only you and the maintainers can see the report. The reply comes there too. The problem is made public once a release fixes it, and the advisory can credit you if you'd like.

## What counts

Anything that lets a file, folder, archive, repository, link or another program make glasshouse do something you didn't ask for. For example:
- running a program or command from a file name, an archive, a git repository's config or a terminal profile;
- reading, writing or deleting outside the folder an operation was meant for, such as an archive entry that escapes the folder it's extracted to, or an operation that follows a link where it shouldn't;
- content shown in the window (a preview, a file name) running script or reaching the app's backend;
- the integration settings (the folder default, "Show in folder", the open and save dialog) letting another user or app act through glasshouse;
- a downloaded release that doesn't match its `SHA256SUMS` or attestation.

Bugs that lose data without a security angle are important too: report those as an ordinary [bug report](https://github.com/Johnson-Anthony/glasshouse/issues/new/choose).

## Supported versions

Fixes go into the next release. Only the [latest release](https://github.com/Johnson-Anthony/glasshouse/releases/latest) is supported, so update before reporting if you can.

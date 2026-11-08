# Layout export file name (presentation task)

The Export/Import Layout file was named after the word the user removed from the project. It is now `.glasshouserc`, still written to and read from the current folder.

- **Chosen:** `.glasshouserc`. Same behavior as before (a hidden file next to where you are), only the name changes.
- **Rejected:** `glasshouse-layout.json`. It's easier to find and opens as JSON in editors, but it changes the feature's behavior (a visible file) for no functional gain.
- Old export files aren't recognized by name any more, and Import only accepts `glasshouse.*` keys, so the old display-tweaks key in them is skipped. The user accepted that display tweaks reset once.

# Miller columns show the plain file name

Date: 2026-11-10 · Task: `miller-names` · Picked by the task session under the lead session's go-ahead.

## Chosen: `e.name` as is, extension not dimmed
Miller rows and the preview title show the full file name in one span, at the row's normal color.

Rejected: splitting off the extension and dimming it, as the main list's `entryToRow` does. Miller's rows are a compact ranger-style list with no extension chip or column. The old code's intent was a plain `name.ext`; it just added the extension a second time.

## Tested by rendering, not through a helper
The fix leaves nothing to compute: the row shows `e.name`. A pure "display name" helper would be the identity function, and testing it would prove nothing. Instead, `src/Miller.test.tsx` server-renders `MillerView` and checks the markup. That catches the real failure, a suffix appended in the JSX.

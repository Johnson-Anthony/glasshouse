# Bulk Rename's digits field sets the width of `{n}`

**Decision (bulk-rename-digits, 2026-11-10):** keep the "digits" field and make it the default width of `{n}`. `{n:W}` stays as a per-token override. The field is clamped to 1–9.

## Alternatives
- **Remove the field, keep only `{n:W}`.** Rejected: the field is the discoverable control, and it sits next to "start", which already works. Removing it would leave padding reachable only through syntax that the dialog shows only in a placeholder.
- **Make the field override `{n:W}`.** Rejected: an explicit width typed into a token is more specific than a dialog-wide setting. A prefix like `{n:2}-` with a suffix `-{n}` can then use two widths in one name.

## Consequences
- With numbering on, `{n}` gives `001` by default instead of `1`, which is what the field always showed.
- The clamp to 9 matches the input's `max={9}`. Wider padding is still possible with `{n:12}`.

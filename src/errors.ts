/** An error's message, or the value itself as text when it isn't an Error. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

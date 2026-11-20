/** An error's message, or the value itself as text when it isn't an Error. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** What a backend command rejects with when it fails in a way the user is
 *  told about (`AppError` in error.rs). Commands not converted yet reject
 *  with plain text instead. */
export interface AppErrorShape {
  /** notFound, permission, exists, notEmpty, readOnly, full, inUse,
   *  notAFolder, isAFolder, badName, tooLarge, otherDisk, missingTool,
   *  cancelled or other. */
  kind: string;
  path: string | null;
  /** A sentence for the user. */
  message: string;
  /** The raw error, with the full path: for "Show details". */
  detail: string;
}

/** A backend error as an Error, so `errText` gives its sentence. */
export class BackendError extends Error {
  readonly kind: string;
  readonly path: string | null;
  readonly detail: string;
  constructor(e: AppErrorShape) {
    super(e.message);
    this.name = "BackendError";
    this.kind = e.kind;
    this.path = e.path;
    this.detail = e.detail;
  }
}

function isAppErrorShape(v: unknown): v is AppErrorShape {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.kind === "string" && typeof o.message === "string" && typeof o.detail === "string";
}

/** What `invoke` rejected with: a BackendError for a structured error,
 *  anything else as it is. */
export function fromBackend(err: unknown): unknown {
  return isAppErrorShape(err) ? new BackendError(err) : err;
}

/** A backend error's kind, or null for any other error. */
export function errKind(err: unknown): string | null {
  return err instanceof BackendError ? err.kind : null;
}

/** The raw text behind an error's message, for "Show details": "" when
 *  there's nothing more than the message. */
export function errDetail(err: unknown): string {
  if (err instanceof BackendError) return err.detail === err.message ? "" : err.detail;
  return "";
}

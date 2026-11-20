import { dialogs } from "./dialogs/DialogHost";
import { errDetail, errText } from "./errors";
import { describeForLog, logWarn } from "./log";

/** An error alert: the error's sentence (a backend error's plain message),
 *  its raw text under "Show details", and a line in the log. `message`
 *  replaces the sentence, e.g. to say what was being done. */
export function showError({ title, err, message }: { title: string; err: unknown; message?: string }): Promise<void> {
  logWarn(`${title}: ${describeForLog(err)}`);
  return dialogs.showAlert({ title, variant: "error", message: message ?? errText(err), detail: errDetail(err) || undefined });
}

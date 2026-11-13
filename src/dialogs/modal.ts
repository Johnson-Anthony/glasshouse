import { useEffect } from "react";

// Whether a modal dialog is open, for the key handlers behind it (App's
// window listener, the file pane, the sidebar): while one is, they
// leave the keyboard to the dialog.
//
// A modal's release is deferred to a later task. The key that closes a
// dialog (Enter in a confirm or the Folder Picker) makes React flush the
// close, and its effect cleanup, in a microtask between two window
// listeners; without the delay a listener that runs after the dialog's own
// would see no modal and act on the same keypress.

let open = 0;

export function isModalOpen(): boolean {
  return open > 0;
}

/** Marks a modal open; call the returned function once when it closes. */
export function holdModal(): () => void {
  open++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    setTimeout(() => { open--; }, 0);
  };
}

/** Holds the modal flag while `active` and the component is mounted. */
export function useModal(active: boolean = true): void {
  useEffect(() => (active ? holdModal() : undefined), [active]);
}

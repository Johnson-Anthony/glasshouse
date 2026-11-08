// The demo leaves pdf.js out (about 1.7 MB); a PDF preview shows this error.
export const GlobalWorkerOptions: { workerSrc?: string } = {};
export function getDocument(): never {
  throw new Error("PDF previews aren't included in the browser demo.");
}
export default "";

/** Find in Files' header status. An empty query never reads "searching…",
 *  even while a cancelled search for the old query is still winding down. */
export function findStatusText(query: string, busy: boolean, ran: boolean, count: number): string {
  if (!query.trim()) return "esc/click to close";
  if (busy) return "searching…";
  return ran ? `${count} match${count === 1 ? "" : "es"}` : "esc/click to close";
}

export function formatTicketKey(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "HUB-?";
  return `HUB-${n}`;
}

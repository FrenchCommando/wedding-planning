interface Guest {
  id: number;
  name: string;
  party?: string;
  unconfirmed?: boolean;
}

interface Table {
  id: number;
  name: string;
  roomId?: number;
  seats: (number | null)[];
}

interface SeatingState {
  guests: Guest[];
  tables: Table[];
  [key: string]: unknown;
}

/**
 * Plain-English summary of what changed between two seating snapshots, for
 * the conflict modal. Display-only — nothing here is applied automatically.
 */
export function diffSeating(baseline: SeatingState, current: SeatingState): string[] {
  const messages: string[] = [];

  const baseGuests = new Map(baseline.guests.map((g) => [g.id, g]));
  const curGuests = new Map(current.guests.map((g) => [g.id, g]));

  for (const [id, g] of curGuests) {
    if (!baseGuests.has(id)) messages.push(`Guest added: ${g.name}`);
  }
  for (const [id, g] of baseGuests) {
    if (!curGuests.has(id)) messages.push(`Guest removed: ${g.name}`);
  }
  for (const [id, before] of baseGuests) {
    const after = curGuests.get(id);
    if (!after) continue;
    if (before.name !== after.name) messages.push(`Guest renamed: ${before.name} → ${after.name}`);
    if (before.party !== after.party) messages.push(`${after.name}: party changed to ${after.party ?? "(none)"}`);
  }

  const baseTables = new Map(baseline.tables.map((t) => [t.id, t]));
  const curTables = new Map(current.tables.map((t) => [t.id, t]));

  for (const [id, t] of curTables) {
    if (!baseTables.has(id)) messages.push(`Table added: ${t.name}`);
  }
  for (const [id, t] of baseTables) {
    if (!curTables.has(id)) messages.push(`Table removed: ${t.name}`);
  }
  for (const [id, before] of baseTables) {
    const after = curTables.get(id);
    if (!after) continue;
    if (before.name !== after.name) messages.push(`Table renamed: ${before.name} → ${after.name}`);

    const len = Math.max(before.seats.length, after.seats.length);
    for (let i = 0; i < len; i++) {
      const b = before.seats[i] ?? null;
      const a = after.seats[i] ?? null;
      if (b === a) continue;
      const guestName = (id: number | null) => (id === null ? null : curGuests.get(id)?.name ?? baseGuests.get(id)?.name ?? `#${id}`);
      if (a !== null) {
        messages.push(`${guestName(a)} moved to ${after.name}, seat ${i + 1}`);
      } else if (b !== null) {
        messages.push(`${guestName(b)} removed from ${after.name}, seat ${i + 1}`);
      }
    }
  }

  return messages;
}

/**
 * Generic plain-English diff engine for this app's Drive-backed JSON data
 * files. Every sub-project's data follows the same shape (per the spec):
 * flat, id-keyed record arrays, and sometimes a fixed-position "slot" array
 * referencing another collection (seating's `tables[].seats` → guest ids).
 * Diff-friendly by construction — which is why this is one reusable engine
 * driven by a small per-sub-project config, not a hand-written diff function
 * copy-pasted for each sub-project. Used by both the save-conflict modal and
 * the "compare with a previous version" (History) feature.
 *
 * Field-level diffing is opt-in per collection (`fields`), not "diff every
 * field" — most fields (position, flags, etc.) aren't worth surfacing, so
 * silence is the default and each sub-project declares only what matters.
 * The same opt-in rule applies to scalar fields at the data root, declared
 * in the config's top-level `fields`.
 */

export interface FieldConfig<T> {
  /** Custom message for this field changing; default: "<label>: <field> changed to <value>". */
  message?(record: T, before: unknown, after: unknown): string;
}

export interface SlotConfig<T> {
  /** Fixed-position array field on T whose entries are ids into `refCollection`, or null. */
  field: string;
  refCollection: string;
  /** Describes one slot for messages, e.g. (table, i) => `${table.name}, seat ${i + 1}`. */
  slotLabel(record: T, index: number): string;
}

export interface CollectionConfig<T = any> {
  /** Human label for one record, e.g. a guest's name or a moment's title. */
  label(record: T): string;
  fields?: Record<string, FieldConfig<T>>;
  slots?: SlotConfig<T>;
}

/**
 * A scalar field living at the data root rather than inside a collection
 * (e.g. welcome-drinks' `extraCount`). Opt-in the same way collection fields
 * are — declared explicitly, silent otherwise.
 */
export interface RootFieldConfig {
  /** Human name used in the default message; defaults to the key itself. */
  label?: string;
  /** Custom message; default: "<label>: <before> → <after>". */
  message?(before: unknown, after: unknown): string;
}

export interface DiffConfig {
  collections: Record<string, CollectionConfig>;
  /** Opt-in scalar fields at the data root, outside any collection. */
  fields?: Record<string, RootFieldConfig>;
}

function byId(arr: any[] | undefined): Map<any, any> {
  const m = new Map<any, any>();
  for (const item of arr ?? []) m.set(item.id, item);
  return m;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null || v === "") return "(none)";
  return String(v);
}

export function diffData(baseline: any, current: any, config: DiffConfig): string[] {
  const changes: string[] = [];

  for (const [key, field] of Object.entries(config.fields ?? {})) {
    const before = baseline?.[key];
    const after = current?.[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push(
      field.message
        ? field.message(before, after)
        : `${field.label ?? key}: ${fmt(before)} → ${fmt(after)}`
    );
  }

  for (const [key, col] of Object.entries(config.collections)) {
    const baseMap = byId(baseline?.[key]);
    const curMap = byId(current?.[key]);

    for (const [id, record] of curMap) {
      if (!baseMap.has(id)) changes.push(`${col.label(record)} added`);
    }
    for (const [id, record] of baseMap) {
      if (!curMap.has(id)) changes.push(`${col.label(record)} removed`);
    }
    for (const [id, after] of curMap) {
      const before = baseMap.get(id);
      if (!before || !col.fields) continue;
      for (const [field, fieldConfig] of Object.entries(col.fields)) {
        if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
        changes.push(
          fieldConfig.message
            ? fieldConfig.message(after, before[field], after[field])
            : `${col.label(after)}: ${field} changed to ${fmt(after[field])}`
        );
      }
    }
  }

  for (const [key, col] of Object.entries(config.collections)) {
    if (col.slots) changes.push(...diffSlots(baseline, current, key, config));
  }

  return changes;
}

function diffSlots(baseline: any, current: any, key: string, config: DiffConfig): string[] {
  const col = config.collections[key];
  const { field, refCollection, slotLabel } = col.slots!;
  const refCol = config.collections[refCollection];
  const changes: string[] = [];

  type Loc = { recordId: any; index: number };
  const baseLocs = new Map<any, Loc>();
  const curLocs = new Map<any, Loc>();
  for (const record of baseline?.[key] ?? []) {
    (record[field] ?? []).forEach((refId: any, i: number) => {
      if (refId != null) baseLocs.set(refId, { recordId: record.id, index: i });
    });
  }
  for (const record of current?.[key] ?? []) {
    (record[field] ?? []).forEach((refId: any, i: number) => {
      if (refId != null) curLocs.set(refId, { recordId: record.id, index: i });
    });
  }

  const refBaseMap = byId(baseline?.[refCollection]);
  const refCurMap = byId(current?.[refCollection]);
  const findRecord = (id: any, arr: any[] | undefined) => (arr ?? []).find((r: any) => r.id === id);

  for (const refId of new Set([...baseLocs.keys(), ...curLocs.keys()])) {
    const from = baseLocs.get(refId);
    const to = curLocs.get(refId);
    const refRecord = refCurMap.get(refId) ?? refBaseMap.get(refId);
    if (!refRecord) continue; // the referenced record itself was removed — its own added/removed message covers this
    const refName = refCol ? refCol.label(refRecord) : String(refId);

    if (from && !to) {
      const fromRec = findRecord(from.recordId, baseline?.[key]);
      if (fromRec) changes.push(`${refName} removed from ${slotLabel(fromRec, from.index)}`);
    } else if (!from && to) {
      const toRec = findRecord(to.recordId, current?.[key]);
      if (toRec) changes.push(`${refName} added to ${slotLabel(toRec, to.index)}`);
    } else if (from && to && (from.recordId !== to.recordId || from.index !== to.index)) {
      const toRec = findRecord(to.recordId, current?.[key]);
      if (toRec) changes.push(`${refName} moved to ${slotLabel(toRec, to.index)}`);
    }
  }

  return changes;
}

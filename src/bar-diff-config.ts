import type { DiffConfig } from "./data-diff.js";

const money = (v: unknown) => (v == null || v === "" ? "—" : `€${v}`);

export const barDiffConfig: DiffConfig = {
  collections: {
    items: {
      label: (i) => i.name || "(unnamed bottle)",
      fields: {
        name: { message: (_rec, before, after) => `Renamed: ${before} → ${after}` },
        category: {},
        moment: {},
        status: { message: (rec, before, after) => `${rec.name}: ${before || "Considering"} → ${after || "Considering"}` },
        quantity: { message: (rec, before, after) => `${rec.name}: quantity ${before ?? 0} → ${after ?? 0}` },
        unit: {},
        unitPrice: { message: (rec, before, after) => `${rec.name}: unit price ${money(before)} → ${money(after)}` },
        supplier: {},
        servingsPerUnit: { message: (rec, before, after) => `${rec.name}: servings per unit ${before ?? "—"} → ${after ?? "—"}` },
        perGuest: { message: (rec, before, after) => `${rec.name}: servings per guest ${before ?? "—"} → ${after ?? "—"}` },
        notes: {},
      },
    },
  },
  fields: {
    guestCount: {
      label: "Drinking headcount",
      message: (before, after) => `Drinking headcount: ${before ?? 0} → ${after ?? 0}`,
    },
    guestCountNote: { label: "Headcount note" },
  },
};

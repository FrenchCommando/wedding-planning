import type { DiffConfig } from "./data-diff.js";

export const stationeryDiffConfig: DiffConfig = {
  collections: {
    items: {
      label: (i) => i.name || "(unnamed piece)",
      fields: {
        name: { message: (_rec, before, after) => `Stationery piece renamed: ${before} → ${after}` },
        status: { message: (rec, before, after) => `${rec.name}: ${before || "—"} → ${after || "—"}` },
        quantity: { message: (rec, before, after) => `${rec.name}: quantity ${before ?? 0} → ${after ?? 0}` },
        vendor: {},
        dueDate: {},
        cost: { message: (rec, before, after) => `${rec.name}: cost ${before ?? 0} → ${after ?? 0}` },
        notes: {},
      },
    },
  },
};

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
        // Long-form copy — diffed as "changed", not spelled out, since the
        // full before/after would drown every other line in the summary.
        wording: { message: (rec) => `${rec.name}: wording changed` },
        noDownload: {
          message: (rec, _before, after) =>
            `${rec.name}: ${after ? "left out of" : "back in"} the Download all handover`,
        },
      },
    },
  },
};

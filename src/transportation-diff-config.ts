import type { DiffConfig } from "./data-diff.js";

const leg = (v: unknown) => (v ? "yes" : "no");

export const transportationDiffConfig: DiffConfig = {
  collections: {
    shuttles: {
      label: (s) => [s.time, s.from && s.to ? `${s.from} → ${s.to}` : s.from || s.to].filter(Boolean).join(" ") || "(shuttle)",
      fields: {
        time: {},
        from: {},
        to: {},
        direction: {},
        capacity: { message: (rec, before, after) => `${rec.time || "Shuttle"} ${rec.from || ""}: capacity ${before ?? 0} → ${after ?? 0}` },
        notes: {},
      },
    },
    riders: {
      label: (g) => g.name,
      fields: {
        name: { message: (_rec, before, after) => `Rider renamed: ${before} → ${after}` },
        household: {},
        toVenue: { message: (rec, before, after) => `${rec.name}: shuttle to the venue ${leg(before)} → ${leg(after)}` },
        back: { message: (rec, before, after) => `${rec.name}: shuttle back ${leg(before)} → ${leg(after)}` },
        notes: {},
      },
    },
  },
  fields: {
    extraCount: {
      label: "Extra headcount",
      message: (before, after) => `Extra headcount: ${before ?? 0} → ${after ?? 0}`,
    },
    extraCountNote: { label: "Extra-headcount note" },
  },
};

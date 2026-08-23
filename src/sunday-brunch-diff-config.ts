import type { DiffConfig } from "./data-diff.js";

export const sundayBrunchDiffConfig: DiffConfig = {
  collections: {
    schedule: {
      label: (m) => m.title || "(untitled)",
      fields: {
        title: { message: (_after, before, after) => `Renamed: ${before} → ${after}` },
        time: {},
        description: {},
      },
    },
    guests: {
      label: (g) => g.name,
      fields: {
        name: { message: (_after, before, after) => `Guest renamed: ${before} → ${after}` },
        household: {},
        dietary: {},
        notes: {},
      },
    },
  },
};

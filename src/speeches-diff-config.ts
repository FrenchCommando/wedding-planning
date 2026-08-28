import type { DiffConfig } from "./data-diff.js";

export const speechesDiffConfig: DiffConfig = {
  collections: {
    speeches: {
      label: (s) => s.speaker || "(unnamed speaker)",
      fields: {
        speaker: { message: (_after, before, after) => `Speech speaker renamed: ${before} → ${after}` },
        relation: {},
        notes: {},
      },
    },
  },
};

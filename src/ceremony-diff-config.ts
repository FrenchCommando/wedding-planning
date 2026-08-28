import type { DiffConfig } from "./data-diff.js";

export const ceremonyDiffConfig: DiffConfig = {
  collections: {
    moments: {
      label: (m) => m.title || "(untitled moment)",
      fields: {
        title: { message: (_after, before, after) => `Moment renamed: ${before} → ${after}` },
        time: {},
        description: {},
        participants: {},
      },
    },
    processionalOrder: {
      label: (p) => p.name,
      fields: {
        name: { message: (_after, before, after) => `Processional entry renamed: ${before} → ${after}` },
        role: {},
        startAt: {},
        emoji: {},
      },
    },
    recessionalOrder: {
      label: (p) => p.name,
      fields: {
        name: { message: (_after, before, after) => `Recessional entry renamed: ${before} → ${after}` },
        role: {},
        startAt: {},
        emoji: {},
      },
    },
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

import type { DiffConfig } from "./data-diff.js";

// Only the segment shell is diffed (name/times/playlist link) — segments'
// nested `items` (bed tracks + cues) are a per-segment ordered list, not a
// flat id-keyed collection, so they don't fit diffData()'s model. A
// per-track diff isn't worth the machinery here: this is a two-person
// planning tool, same reasoning as seating/ceremony's "not a crowd" call.
export const playlistDiffConfig: DiffConfig = {
  collections: {
    segments: {
      label: (s) => s.name || "(untitled)",
      fields: {
        name: { message: (_after, before, after) => `Renamed: ${before} → ${after}` },
        start: {},
        end: {},
        playlistName: {},
      },
    },
  },
};

import type { DiffConfig } from "./data-diff.js";

export const scriptDiffConfig: DiffConfig = {
  collections: {
    sections: {
      label: (s) => s.heading || "(untitled section)",
      fields: {
        heading: { message: (_after, before, after) => `Section renamed: ${before} → ${after}` },
        // Full text is opt-in as a single changed/unchanged flag, not a
        // line-level diff — diffData()'s field comparison isn't built for
        // long-form text, and "the wording changed" is enough of a signal
        // to prompt reading the section again, same reasoning as ceremony's
        // moment descriptions.
        body: { message: () => "wording changed" },
      },
    },
  },
};

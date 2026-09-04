import type { DiffConfig } from "./data-diff.js";

export const seatingDiffConfig: DiffConfig = {
  collections: {
    guests: {
      label: (g) => g.name,
      fields: {
        name: { message: (_after, before, after) => `Guest renamed: ${before} → ${after}` },
        party: {}, // default message: "<name>: party changed to <value>"
        unconfirmed: {
          message: (after, _before, now) =>
            now ? `${after.name} marked awaiting RSVP` : `${after.name} marked confirmed`,
        },
      },
    },
    tables: {
      label: (t) => t.name,
      fields: {
        name: { message: (_after, before, after) => `Table renamed: ${before} → ${after}` },
      },
      slots: {
        field: "seats",
        refCollection: "guests",
        slotLabel: (t, i) => `${t.name}, seat ${i + 1}`,
      },
    },
  },
};

import type { DiffConfig } from "./data-diff.js";

const label = (i: any) => [i.vendor, i.description].filter(Boolean).join(" — ") || "(unnamed payment)";
const money = (v: unknown) => (v == null || v === "" ? "—" : String(v));

export const paymentsDiffConfig: DiffConfig = {
  collections: {
    items: {
      label,
      fields: {
        vendor: { message: (_rec, before, after) => `Vendor renamed: ${before} → ${after}` },
        description: {},
        amount: { message: (rec, before, after) => `${label(rec)}: amount ${money(before)} → ${money(after)}` },
        status: { message: (rec, before, after) => `${label(rec)}: ${before || "Pending"} → ${after || "Pending"}` },
        dueDate: { message: (rec, before, after) => `${label(rec)}: due ${before || "—"} → ${after || "—"}` },
        paidDate: { message: (rec, before, after) => `${label(rec)}: paid ${before || "—"} → ${after || "—"}` },
        method: {},
        emoji: {},
        notes: {},
      },
    },
  },
  fields: {
    currency: { label: "Currency" },
  },
};

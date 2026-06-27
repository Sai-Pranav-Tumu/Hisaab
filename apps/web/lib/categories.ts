import { ACCENT } from "./theme";

export interface CategoryMeta {
  label: string;
  color: string;
  counts?: boolean;
}

/** Transaction categories. Only `business_income` credits count toward taxable receipts. */
export const CATS: Record<string, CategoryMeta> = {
  business_income: { label: "Business income", color: ACCENT, counts: true },
  transfer_in: { label: "Transfer", color: "#7A6FF0" },
  refund: { label: "Refund", color: "#C2761A" },
  interest: { label: "Interest", color: "#3B82B8" },
  expense: { label: "Expense", color: "#9AA0A6" },
  other: { label: "Other", color: "#9AA0A6" },
};

/** Canonical category keys, shared with the classifier's structured-output schema. */
export const CATEGORY_KEYS = Object.keys(CATS) as Array<keyof typeof CATS & string>;

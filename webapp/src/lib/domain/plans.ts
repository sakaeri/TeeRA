import "server-only";

// 製品定数（recruitment.tsのPER_ENTRY_TEE_COSTと同じ扱い — envには出さない）。
export const PLAN_YEN: Record<"STANDARD" | "BUSINESS", number> = {
  STANDARD: 3980,
  BUSINESS: 7980,
};

export const PLAN_PDF_QUOTA: Record<"FREE" | "STANDARD" | "BUSINESS", number> = {
  FREE: 0,
  STANDARD: 30,
  BUSINESS: 100,
};

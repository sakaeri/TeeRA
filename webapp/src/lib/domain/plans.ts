import "server-only";
import { prisma } from "@/lib/prisma";
import { currentJstMonthRangeUtc } from "@/lib/date";
import type { Prisma } from "@/generated/prisma/client";
import type { PlanTier } from "@/generated/prisma/enums";

type Tx = Prisma.TransactionClient;

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

// 給与明細＋請求書の合算で、当月（JST暦月）にcountsAgainstQuota=trueで
// 発行された件数。issueSalarySlip/issueInvoiceでの新規判定にも、UI表示用の
// pdfQuotaRemainingにも使う共通クエリ。
async function countPdfQuotaUsedThisMonth(tx: Tx | typeof prisma, companyId: string): Promise<number> {
  const { start, end } = currentJstMonthRangeUtc();
  const [slipCount, invoiceCount] = await Promise.all([
    tx.salarySlipIssue.count({
      where: { countsAgainstQuota: true, issuedAt: { gte: start, lt: end }, salarySlip: { companyId } },
    }),
    tx.invoiceIssue.count({
      where: { countsAgainstQuota: true, issuedAt: { gte: start, lt: end }, invoice: { issuingCompanyId: companyId } },
    }),
  ]);
  return slipCount + invoiceCount;
}

// issueSalarySlip/issueInvoiceの初回発行判定で使う — 今回の発行が無料枠に
// 収まるかを返す。集計にロックは掛けない（境界での稀な二重無料発行は
// 許容 — Tee残高という金銭的な不変条件には触れない表示上のクォータのため）。
export async function hasRemainingPdfQuota(tx: Tx, companyId: string, planTier: PlanTier): Promise<boolean> {
  const quota = PLAN_PDF_QUOTA[planTier];
  if (quota <= 0) return false;
  const used = await countPdfQuotaUsedThisMonth(tx, companyId);
  return used < quota;
}

// 給与計算/請求書メニューでの表示用 — 今月の残り無料発行枠（無料プランは常に0）。
export async function pdfQuotaRemaining(companyId: string): Promise<{ quota: number; used: number; remaining: number }> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { planTier: true } });
  const quota = PLAN_PDF_QUOTA[company.planTier];
  const used = quota > 0 ? await countPdfQuotaUsedThisMonth(prisma, companyId) : 0;
  return { quota, used, remaining: Math.max(0, quota - used) };
}

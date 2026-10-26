import "server-only";
import { prisma } from "@/lib/prisma";
import { todayJstParts } from "@/lib/date";
import type { Prisma } from "@/generated/prisma/client";
import type { PlanTier } from "@/generated/prisma/enums";

type Tx = Prisma.TransactionClient;

function currentJstTargetMonth(): string {
  const { year, month } = todayJstParts();
  return `${year}-${String(month).padStart(2, "0")}`;
}

// 製品定数（recruitment.tsのPER_ENTRY_TEE_COSTと同じ扱い — envには出さない）。
export type PaidPlanTier = Exclude<PlanTier, "FREE">;

export const PLAN_YEN: Record<PaidPlanTier, number> = {
  STANDARD: 3980,
  BUSINESS: 7980,
  PRO: 19800,
  ENTERPRISE: 39800,
};

export const PLAN_LABEL: Record<PlanTier, string> = {
  FREE: "無料",
  STANDARD: "スタンダード",
  BUSINESS: "ビジネス",
  PRO: "プロ",
  ENTERPRISE: "エンタープライズ",
};

// 月あたりのPDF発行の無料枠（Infinity＝無制限）
export const PLAN_PDF_QUOTA: Record<PlanTier, number> = {
  FREE: 0,
  STANDARD: 30,
  BUSINESS: 100,
  PRO: 500,
  ENTERPRISE: Number.POSITIVE_INFINITY,
};

// 給与明細＋請求書の合算で、当月（JST暦月）が対象月（稼働月）の発行として
// countsAgainstQuota=trueでカウントされた件数。発行した操作日ではなく、
// 明細・請求書自体の対象月（targetMonth/periodLabel）で数える — 10月に
// なってから9月分を発行しても、9月分の枠は消費しない。issueSalarySlip/
// issueInvoiceでの新規判定にも、UI表示用のpdfQuotaRemainingにも使う共通
// クエリ。
async function countPdfQuotaUsedThisMonth(tx: Tx | typeof prisma, companyId: string): Promise<number> {
  const targetMonth = currentJstTargetMonth();
  const [slipCount, invoiceCount] = await Promise.all([
    tx.salarySlipIssue.count({
      where: { countsAgainstQuota: true, salarySlip: { companyId, targetMonth } },
    }),
    tx.invoiceIssue.count({
      where: { countsAgainstQuota: true, invoice: { issuingCompanyId: companyId, periodLabel: targetMonth } },
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
// 無制限のプランはunlimited=trueで返す（Infinityは画面へ渡さず、quota/remainingは0にする）。
export async function pdfQuotaRemaining(
  companyId: string,
): Promise<{ quota: number; used: number; remaining: number; unlimited: boolean }> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { planTier: true } });
  const quota = PLAN_PDF_QUOTA[company.planTier];
  if (!Number.isFinite(quota)) return { quota: 0, used: 0, remaining: 0, unlimited: true };
  const used = quota > 0 ? await countPdfQuotaUsedThisMonth(prisma, companyId) : 0;
  return { quota, used, remaining: Math.max(0, quota - used), unlimited: false };
}

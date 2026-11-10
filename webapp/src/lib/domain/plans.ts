import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PlanTier } from "@/generated/prisma/enums";
import { earliestAllowedMonth, cutoffMonthString } from "@/lib/date";

type Tx = Prisma.TransactionClient;

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

// 給与明細＋請求書（＋業務委託のスタッフから届いた請求書を開いた分）の合算で、その対象月（稼働月）の分としてcountsAgainstQuota=trueで
// 発行した件数。発行した日ではなく、明細・請求書自体の対象月（targetMonth/periodLabel）
// で数える — 11月になってから10月分を発行したら10月分の枠を使う。会社全体での件数で、
// 誰が発行したかは関係ない。
async function countPdfQuotaUsed(tx: Tx | typeof prisma, companyId: string, targetMonth: string): Promise<number> {
  const [slipCount, invoiceCount, staffInvoiceCount] = await Promise.all([
    tx.salarySlipIssue.count({
      where: { countsAgainstQuota: true, salarySlip: { companyId, targetMonth } },
    }),
    tx.invoiceIssue.count({
      where: { countsAgainstQuota: true, invoice: { issuingCompanyId: companyId, periodLabel: targetMonth } },
    }),
    // 業務委託のスタッフから届いた請求書を開いた分（staffInvoices.ts）
    tx.staffInvoice.count({ where: { countsAgainstQuota: true, companyId, targetMonth } }),
  ]);
  return slipCount + invoiceCount + staffInvoiceCount;
}

// issueSalarySlip/issueInvoiceの初回発行判定で使う — 今回の発行が無料枠に
// 収まるかを返す。集計にロックは掛けない（境界での稀な二重無料発行は
// 許容 — Tee残高という金銭的な不変条件には触れない表示上のクォータのため）。
// targetMonthは発行する明細・請求書の対象月（"2026-10"）。今日の月ではない。
export async function hasRemainingPdfQuota(tx: Tx, companyId: string, planTier: PlanTier, targetMonth: string): Promise<boolean> {
  const quota = PLAN_PDF_QUOTA[planTier];
  if (quota <= 0) return false;
  const used = await countPdfQuotaUsed(tx, companyId, targetMonth);
  return used < quota;
}

// 給与計算/請求書メニューでの表示用 — 今月の残り無料発行枠（無料プランは常に0）。
// 無制限のプランはunlimited=trueで返す（Infinityは画面へ渡さず、quota/remainingは0にする）。
export async function pdfQuotaRemaining(
  companyId: string,
  // 表示している月（"2026-10"）。その月分の枠の残りを返す
  targetMonth: string,
): Promise<{ quota: number; used: number; remaining: number; unlimited: boolean }> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { planTier: true } });
  const quota = PLAN_PDF_QUOTA[company.planTier];
  if (!Number.isFinite(quota)) return { quota: 0, used: 0, remaining: 0, unlimited: true };
  const used = quota > 0 ? await countPdfQuotaUsed(prisma, companyId, targetMonth) : 0;
  return { quota, used, remaining: Math.max(0, quota - used), unlimited: false };
}

// 無料プランの会社は、過去のデータを直近3か月分（今月と前の2か月）だけ見られる。画面と同じ制限を、
// 会社側のPDF（給料明細・請求書・カレンダーなど）にもかける。month は "YYYY-MM"。
// スタッフ本人が自分の明細・請求書を見る時には使わない（本人の記録なので会社のプランで隠さない）。
export const FREE_PLAN_PDF_HIDDEN_MESSAGE = "無料プランでは、直近3か月より前のPDFは見られません。有料プランにすると見られます。";

export async function isMonthHiddenByFreePlan(companyId: string, month: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { planTier: true } });
  if (!company) return true;
  const min = cutoffMonthString(earliestAllowedMonth(company.planTier));
  return min !== null && month < min;
}

export function freePlanHiddenResponse() {
  return new Response(FREE_PLAN_PDF_HIDDEN_MESSAGE, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

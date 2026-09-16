import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { TeeLedgerEntryType } from "@/generated/prisma/enums";

type Tx = Prisma.TransactionClient;

// Core ledger primitive: every Tee balance change goes through here, inside
// the caller's transaction, so balance and ledger history can never drift
// apart and the balance can never go negative (開発指示書 §5 ledger-integrity
// requirement — the prototype's single mutable number is explicitly called
// out as needing this for the real implementation).
export async function postLedgerEntry(
  tx: Tx,
  params: {
    companyId: string;
    type: TeeLedgerEntryType;
    amount: number; // signed: positive = credit, negative = debit
    publicRecruitmentId?: string;
    stripeChargeId?: string;
    bankTransferRequestId?: string;
    teamId?: string;
    createdByUserId?: string;
  },
) {
  const company = await tx.company.findUniqueOrThrow({
    where: { id: params.companyId },
    select: { teeBalance: true },
  });

  const balanceAfter = company.teeBalance + params.amount;
  if (balanceAfter < 0) {
    throw new Error("insufficient_tee_balance");
  }

  // teeBalanceを読んだ時点の値をWHERE条件に含めることで楽観ロックにする —
  // 同じ会社への2件の課金がほぼ同時に来た場合、後からUPDATEする側は
  // teeBalanceが既に変わっているためcount=0になり、古い残高から計算した
  // balanceAfterで上書きしてしまう（残高とTeeLedgerEntry合計がズレる）
  // レースを防ぐ（redeemPromoItemの在庫ガードと同じ考え方）。
  const result = await tx.company.updateMany({
    where: { id: params.companyId, teeBalance: company.teeBalance },
    data: { teeBalance: balanceAfter },
  });
  if (result.count === 0) {
    throw new Error("insufficient_tee_balance");
  }

  return tx.teeLedgerEntry.create({
    data: {
      companyId: params.companyId,
      type: params.type,
      amount: params.amount,
      balanceAfter,
      publicRecruitmentId: params.publicRecruitmentId,
      stripeChargeId: params.stripeChargeId,
      bankTransferRequestId: params.bankTransferRequestId,
      teamId: params.teamId,
      createdByUserId: params.createdByUserId,
    },
  });
}

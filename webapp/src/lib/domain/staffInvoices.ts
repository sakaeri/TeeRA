import "server-only";
import { prisma } from "@/lib/prisma";
import { computeApprovedWorkLines, type ComputedWorkLine } from "@/lib/domain/payroll";
import { hasRemainingPdfQuota } from "@/lib/domain/plans";
import { postLedgerEntry } from "@/lib/domain/wallet";
import { computeStaffInvoiceTotals, sanitizeExpenses, isValidTargetMonth, type StaffInvoiceExpense } from "@/lib/staffInvoiceTotals";

export { computeStaffInvoiceTotals, sanitizeExpenses, isValidTargetMonth, type StaffInvoiceExpense };

// 業務委託のスタッフから会社へ出す請求書。
// ・業務の行は承認済みの業務報告から自動で作る（給与明細と同じ単価）。スタッフは金額を直せず、
//   足せるのは「その他の項目」（交通費など）の行と備考だけ。
// ・源泉徴収するか・消費税を上乗せするかは、会社がスタッフごとに決める（CompanyMembership）。
// ・会社は最初に開いた時に1件分（プランの無料枠、無ければ1Tee）使う。同じスタッフの同じ月は
//   1回だけ（直して再提出されても無料）。その月の支払明細をもう発行していれば無料。

function monthRange(targetMonth: string) {
  const [year, month] = targetMonth.split("-").map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

// 請求書を出せるのは「その会社との今の契約が業務委託」の人だけ。
// ・同意済みで有効（ACTIVE）な契約があれば、その中で一番新しい契約の雇用形態で決める
//   （昔の業務委託の契約が残っていても、今がアルバイトなら出せない）
// ・有効な契約が無い（終わった）場合は、一番新しい契約が業務委託で、終わってから2か月以内のときだけ
//   出せる（最後の月の分を、月が明けてから出せるように）
const ENDED_GRACE_DAYS = 62;
type ContractRow = {
  status: string;
  createdAt: Date;
  updatedAt: Date;
  contractEndDate: Date | null;
  template: { companyId: string; employmentType: string; contractEndDate: Date | null; company: { id: string; name: string } };
};
function isCurrentlyContractor(contracts: ContractRow[], now = new Date()) {
  const active = contracts.filter((c) => c.status === "ACTIVE").sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  if (active.length > 0) return active[0].template.employmentType === "CONTRACTOR";
  const ended = contracts.filter((c) => c.status === "ENDED").sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  const latest = ended[0];
  if (!latest || latest.template.employmentType !== "CONTRACTOR") return false;
  const endedAt = latest.contractEndDate ?? latest.template.contractEndDate ?? latest.updatedAt;
  return now.getTime() - endedAt.getTime() <= ENDED_GRACE_DAYS * 24 * 3600e3;
}

async function contractsOf(staffUserId: string, companyId?: string) {
  return prisma.staffContract.findMany({
    where: { staffUserId, status: { not: "PENDING_CONSENT" }, ...(companyId ? { template: { companyId } } : {}) },
    select: {
      status: true,
      createdAt: true,
      updatedAt: true,
      contractEndDate: true,
      template: { select: { companyId: true, employmentType: true, contractEndDate: true, company: { select: { id: true, name: true } } } },
    },
  });
}

export async function isContractorOf(staffUserId: string, companyId: string) {
  return isCurrentlyContractor(await contractsOf(staffUserId, companyId));
}

// スタッフが請求書を出せる会社（今の契約が業務委託の、所属している会社）
export async function listContractorCompanies(staffUserId: string) {
  const [contracts, memberships] = await Promise.all([
    contractsOf(staffUserId),
    prisma.companyMembership.findMany({ where: { userId: staffUserId }, select: { companyId: true } }),
  ]);
  const memberOf = new Set(memberships.map((m) => m.companyId));
  const byCompany = new Map<string, ContractRow[]>();
  for (const c of contracts) {
    if (!memberOf.has(c.template.companyId)) continue;
    byCompany.set(c.template.companyId, [...(byCompany.get(c.template.companyId) ?? []), c]);
  }
  return [...byCompany.values()].filter((rows) => isCurrentlyContractor(rows)).map((rows) => rows[0].template.company);
}

async function countPendingReports(companyId: string, staffUserId: string, targetMonth: string) {
  const { start, end } = monthRange(targetMonth);
  return prisma.workReport.count({
    where: {
      staffUserId,
      outcome: "WORKED",
      approvalStatus: { not: "APPROVED" },
      shift: { companyId, date: { gte: start, lt: end } },
    },
  });
}

// スタッフの画面に出す請求書（まだ作っていなければ、保存せずに下書きの中身だけを返す）。
// 下書き・差し戻し中は業務の行を毎回作り直し、提出後・承認後は提出した時点の行のまま。
export async function getStaffInvoiceForStaff(staffUserId: string, companyId: string, targetMonth: string) {
  const [membership, user, existing, latestContract, previous] = await Promise.all([
    prisma.companyMembership.findUniqueOrThrow({ where: { userId_companyId: { userId: staffUserId, companyId } } }),
    prisma.user.findUniqueOrThrow({ where: { id: staffUserId } }),
    prisma.staffInvoice.findUnique({ where: { companyId_staffUserId_targetMonth: { companyId, staffUserId, targetMonth } } }),
    prisma.staffContract.findFirst({
      where: { staffUserId, status: { not: "PENDING_CONSENT" }, template: { companyId } },
      orderBy: { createdAt: "desc" },
      select: { partyName: true, partyAddress: true },
    }),
    prisma.staffInvoice.findFirst({
      where: { companyId, staffUserId, targetMonth: { lt: targetMonth } },
      orderBy: { targetMonth: "desc" },
      select: { issuerName: true, issuerAddress: true },
    }),
  ]);

  const editable = !existing || existing.status === "DRAFT" || existing.status === "RETURNED";
  const workLines: ComputedWorkLine[] = editable
    ? (await computeApprovedWorkLines({ companyId, staffUserId, targetMonth })).lines.sort((a, b) =>
        a.description.localeCompare(b.description),
      )
    : (existing!.workLines as ComputedWorkLine[]);
  const expenses = sanitizeExpenses(existing?.expenses ?? []);
  const withholding = editable ? membership.contractorWithholding : existing!.withholding;
  const taxExclusive = editable ? membership.contractorTaxExclusive : existing!.taxExclusive;
  const totals = editable
    ? computeStaffInvoiceTotals({ workLines, expenses, withholding, taxExclusive })
    : {
        workSubtotal: existing!.workSubtotal,
        taxAmount: existing!.taxAmount,
        withholdingAmount: existing!.withholdingAmount,
        expensesTotal: existing!.expensesTotal,
        total: existing!.total,
      };

  return {
    id: existing?.id ?? null,
    status: existing?.status ?? "DRAFT",
    editable,
    workLines,
    expenses,
    note: existing?.note ?? "",
    issuerName: existing?.issuerName ?? previous?.issuerName ?? latestContract?.partyName ?? user.name,
    issuerAddress: existing?.issuerAddress ?? previous?.issuerAddress ?? latestContract?.partyAddress ?? user.address ?? "",
    registrationNumber: existing?.registrationNumber ?? user.invoiceRegistrationNumber ?? "",
    bank: editable
      ? {
          bankName: membership.bankName,
          branchName: membership.branchName,
          accountType: membership.accountType,
          accountNumber: membership.accountNumber,
          accountHolderName: membership.accountHolderName,
        }
      : {
          bankName: existing!.bankName,
          branchName: existing!.branchName,
          accountType: existing!.accountType,
          accountNumber: existing!.accountNumber,
          accountHolderName: existing!.accountHolderName,
        },
    withholding,
    taxExclusive,
    ...totals,
    pendingReportCount: editable ? await countPendingReports(companyId, staffUserId, targetMonth) : 0,
    submittedAt: existing?.submittedAt?.toISOString() ?? null,
    reviewedAt: existing?.reviewedAt?.toISOString() ?? null,
    returnReason: existing?.returnReason ?? null,
  };
}

export type StaffInvoiceInput = {
  expenses: StaffInvoiceExpense[];
  note: string;
  issuerName: string;
  issuerAddress: string;
  registrationNumber: string;
};

export class StaffInvoiceError extends Error {}

// 下書きの保存（submit=trueなら提出まで）。提出した時点の業務の行・振込先・会社の設定（源泉・消費税）を写して固定する。
export async function saveStaffInvoice(params: {
  staffUserId: string;
  companyId: string;
  targetMonth: string;
  input: StaffInvoiceInput;
  submit: boolean;
}) {
  const { staffUserId, companyId, targetMonth } = params;
  if (!isValidTargetMonth(targetMonth)) throw new StaffInvoiceError("対象月が正しくありません。");
  if (!(await isContractorOf(staffUserId, companyId))) throw new StaffInvoiceError("業務委託の契約がある会社にだけ請求書を出せます。");

  const existing = await prisma.staffInvoice.findUnique({
    where: { companyId_staffUserId_targetMonth: { companyId, staffUserId, targetMonth } },
  });
  if (existing && existing.status !== "DRAFT" && existing.status !== "RETURNED") {
    throw new StaffInvoiceError("提出済みの請求書は直せません。会社から差し戻されると直せるようになります。");
  }

  const membership = await prisma.companyMembership.findUniqueOrThrow({
    where: { userId_companyId: { userId: staffUserId, companyId } },
  });
  const expenses = sanitizeExpenses(params.input.expenses);
  const issuerName = params.input.issuerName.trim().slice(0, 100);
  const issuerAddress = params.input.issuerAddress.trim().slice(0, 200);
  const registrationNumber = params.input.registrationNumber.trim().toUpperCase().slice(0, 20);
  if (registrationNumber && !/^T\d{13}$/.test(registrationNumber)) {
    throw new StaffInvoiceError("登録番号は「T」と13桁の数字で入力してください（無い場合は空欄のまま）。");
  }
  const note = params.input.note.trim().slice(0, 500);

  const { lines } = await computeApprovedWorkLines({ companyId, staffUserId, targetMonth });
  const workLines = lines.sort((a, b) => a.description.localeCompare(b.description));
  if (params.submit) {
    if (!issuerName) throw new StaffInvoiceError("名前を入力してください。");
    if (!issuerAddress) throw new StaffInvoiceError("住所を入力してください。");
    if (workLines.length === 0 && expenses.length === 0) {
      throw new StaffInvoiceError("この月の承認済みの勤務がありません。会社が業務報告を承認すると請求書に入ります。");
    }
  }
  const totals = computeStaffInvoiceTotals({
    workLines,
    expenses,
    withholding: membership.contractorWithholding,
    taxExclusive: membership.contractorTaxExclusive,
  });

  const data = {
    workLines,
    expenses,
    note: note || null,
    issuerName: issuerName || null,
    issuerAddress: issuerAddress || null,
    registrationNumber: registrationNumber || null,
    bankName: membership.bankName,
    branchName: membership.branchName,
    accountType: membership.accountType,
    accountNumber: membership.accountNumber,
    accountHolderName: membership.accountHolderName,
    withholding: membership.contractorWithholding,
    taxExclusive: membership.contractorTaxExclusive,
    ...totals,
    ...(params.submit ? { status: "SUBMITTED" as const, submittedAt: new Date(), returnReason: null } : {}),
  };

  const saved = await prisma.$transaction(async (tx) => {
    // 登録番号は本人の情報として覚えておき、次の請求書（他の会社宛ても）に自動で入れる
    await tx.user.update({ where: { id: staffUserId }, data: { invoiceRegistrationNumber: registrationNumber || null } });
    return existing
      ? tx.staffInvoice.update({ where: { id: existing.id }, data })
      : tx.staffInvoice.create({ data: { companyId, staffUserId, targetMonth, ...data } });
  });
  return { invoice: saved, wasResubmission: Boolean(params.submit && existing?.submittedAt) };
}

// 会社の画面の「業務委託のスタッフから届いた請求書」— 提出済み・差し戻し中・承認済み（下書きは出さない）
export async function listReceivedStaffInvoices(companyId: string, targetMonth: string, staffUserIds: Set<string>) {
  const rows = await prisma.staffInvoice.findMany({
    where: { companyId, targetMonth, status: { not: "DRAFT" }, submittedAt: { not: null } },
    include: { staff: { select: { name: true } } },
    orderBy: { submittedAt: "asc" },
  });
  return rows.filter((r) => staffUserIds.has(r.staffUserId));
}

// 開く時に1件分使うかどうか（画面の確認メッセージ用）。すでにこの月の分を精算済み・支払明細を発行済みなら無料
export async function staffInvoiceOpenCost(invoice: { companyId: string; staffUserId: string; targetMonth: string; chargeSettledAt: Date | null }) {
  if (invoice.chargeSettledAt) return "free" as const;
  const issued = await prisma.salarySlipIssue.count({
    where: { salarySlip: { companyId: invoice.companyId, staffUserId: invoice.staffUserId, targetMonth: invoice.targetMonth } },
  });
  return issued > 0 ? ("free" as const) : ("charge" as const);
}

// 会社が請求書を開く（最初の1回だけ課金）。Teeが足りなければ insufficient_tee_balance を投げる。
export async function openStaffInvoice(params: { invoiceId: string; companyId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.staffInvoice.findUniqueOrThrow({ where: { id: params.invoiceId } });
    if (invoice.companyId !== params.companyId || !invoice.submittedAt) throw new Error("forbidden");
    if (invoice.chargeSettledAt) {
      if (!invoice.openedAt) {
        await tx.staffInvoice.update({ where: { id: invoice.id }, data: { openedAt: new Date(), openedByUserId: params.userId } });
      }
      return { charged: "none" as const };
    }
    const issued = await tx.salarySlipIssue.count({
      where: { salarySlip: { companyId: invoice.companyId, staffUserId: invoice.staffUserId, targetMonth: invoice.targetMonth } },
    });
    let countsAgainstQuota = false;
    let chargedTee = false;
    if (issued === 0) {
      const company = await tx.company.findUniqueOrThrow({ where: { id: invoice.companyId }, select: { planTier: true } });
      countsAgainstQuota = await hasRemainingPdfQuota(tx, invoice.companyId, company.planTier, invoice.targetMonth);
      if (!countsAgainstQuota) {
        chargedTee = true;
        await postLedgerEntry(tx, {
          companyId: invoice.companyId,
          type: "CONSUME_STAFF_INVOICE_OPEN",
          amount: -1,
          createdByUserId: params.userId,
        });
      }
    }
    await tx.staffInvoice.update({
      where: { id: invoice.id },
      data: {
        openedAt: invoice.openedAt ?? new Date(),
        openedByUserId: invoice.openedByUserId ?? params.userId,
        chargeSettledAt: new Date(),
        countsAgainstQuota,
        chargedTee,
      },
    });
    return { charged: chargedTee ? ("tee" as const) : countsAgainstQuota ? ("quota" as const) : ("none" as const) };
  });
}

export async function reviewStaffInvoice(params: {
  invoiceId: string;
  companyId: string;
  userId: string;
  decision: "approve" | "return";
  reason?: string;
}) {
  const invoice = await prisma.staffInvoice.findUniqueOrThrow({ where: { id: params.invoiceId } });
  if (invoice.companyId !== params.companyId) throw new Error("forbidden");
  if (!invoice.chargeSettledAt) throw new StaffInvoiceError("先に請求書を開いて内容を確認してください。");
  if (invoice.status !== "SUBMITTED") throw new StaffInvoiceError("この請求書は確認待ちではありません。");
  const reason = (params.reason ?? "").trim().slice(0, 500);
  if (params.decision === "return" && !reason) throw new StaffInvoiceError("差し戻す理由を入力してください。");
  return prisma.staffInvoice.update({
    where: { id: invoice.id },
    data: {
      status: params.decision === "approve" ? "APPROVED" : "RETURNED",
      reviewedAt: new Date(),
      reviewedByUserId: params.userId,
      returnReason: params.decision === "return" ? reason : null,
    },
  });
}

// 会社がスタッフごとの扱い（源泉徴収・消費税）を変える。確認待ちの請求書があれば、その金額も今の設定で計算し直す
// （スタッフが入れた内容は変わらず、会社が決める源泉・消費税だけが変わる）。
export async function updateContractorSettings(params: {
  companyId: string;
  staffUserId: string;
  withholding: boolean;
  taxExclusive: boolean;
}) {
  await prisma.companyMembership.update({
    where: { userId_companyId: { userId: params.staffUserId, companyId: params.companyId } },
    data: { contractorWithholding: params.withholding, contractorTaxExclusive: params.taxExclusive },
  });
  const pending = await prisma.staffInvoice.findMany({
    where: { companyId: params.companyId, staffUserId: params.staffUserId, status: "SUBMITTED" },
  });
  for (const inv of pending) {
    const totals = computeStaffInvoiceTotals({
      workLines: inv.workLines as ComputedWorkLine[],
      expenses: sanitizeExpenses(inv.expenses),
      withholding: params.withholding,
      taxExclusive: params.taxExclusive,
    });
    await prisma.staffInvoice.update({
      where: { id: inv.id },
      data: { withholding: params.withholding, taxExclusive: params.taxExclusive, ...totals },
    });
  }
}

// 給料明細の画面で「この月は請求書を受け取り済み（支払明細は要りません）」と出すため
export async function approvedStaffInvoiceStaffIds(companyId: string, targetMonth: string) {
  const rows = await prisma.staffInvoice.findMany({
    where: { companyId, targetMonth, status: "APPROVED" },
    select: { staffUserId: true },
  });
  return new Set(rows.map((r) => r.staffUserId));
}

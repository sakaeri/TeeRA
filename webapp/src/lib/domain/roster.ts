import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createInvite } from "@/lib/domain/invites";
import { todayJst, todayJstParts } from "@/lib/date";
import { resolveRateVersion, resolveContractWageVersion } from "@/lib/domain/contracts";
import type { TeamRole } from "@/generated/prisma/enums";

// role=STAFFの人に加え、兼務でcanWorkShifts=trueの管理者/編集者も含む —
// シフト割当の選択肢に出す・稼働実績を記録する対象という意味では両者は
// 同じ扱いになる。
export async function listStaff(companyId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }] },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  const userIds = memberships.map((m) => m.userId);
  const teamMemberships = await prisma.teamMembership.findMany({
    where: { userId: { in: userIds }, team: { companyId } },
    include: { team: true },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    isProxy: m.user.isProxy,
    createdAt: m.createdAt,
    teams: teamMemberships
      .filter((tm) => tm.userId === m.userId)
      .map((tm) => ({ teamId: tm.teamId, teamName: tm.team.name, role: tm.role })),
  }));
}

function formatJstTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };
const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};

// Roster table summary: 今月稼働 (hours worked this month from approved WORKED
// reports), 契約内容 (from the staff's active contract), 契約書 status pill.
export async function listStaffWithSummary(companyId: string) {
  const staff = await listStaff(companyId);
  const userIds = staff.map((s) => s.userId);
  if (userIds.length === 0) return staff.map((s) => ({ ...s, monthlyHours: 0, contractLabel: "—", contractStatus: "未送付" as const }));

  const today = todayJstParts();
  const start = new Date(Date.UTC(today.year, today.month - 1, 1));
  const end = new Date(Date.UTC(today.year, today.month, 1));

  const [reports, contracts] = await Promise.all([
    prisma.workReport.findMany({
      where: {
        staffUserId: { in: userIds },
        outcome: "WORKED",
        approvalStatus: "APPROVED",
        shift: { date: { gte: start, lt: end } },
      },
    }),
    prisma.staffContract.findMany({
      where: { staffUserId: { in: userIds }, status: { in: ["ACTIVE", "PENDING_CONSENT"] } },
      include: { template: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return staff.map((s) => {
    const hours = reports
      .filter((r) => r.staffUserId === s.userId)
      .reduce((sum, r) => sum + r.computedMinutes / 60, 0);

    const contract = contracts.find((c) => c.staffUserId === s.userId);
    // template.titleは「雇用形態・業務内容」（例：業務委託・キャディ業務）が
    // 自動で入る内部向けタイトル。単価ではなく契約の中身が分かる方が名簿では
    // 有用なため、こちらをそのまま契約内容として表示する。
    const contractLabel = contract ? contract.template.title : "—";
    const contractStatus = contract
      ? contract.status === "ACTIVE"
        ? ("確認済み" as const)
        : ("確認待ち" as const)
      : ("未送付" as const);

    return { ...s, monthlyHours: Math.round(hours * 10) / 10, contractLabel, contractStatus };
  });
}

export async function inviteStaff(params: {
  companyId: string;
  createdByUserId: string;
  teamId?: string;
  contractTemplateId?: string;
  contractStartDate?: Date;
}) {
  return createInvite({
    kind: "STAFF",
    companyId: params.companyId,
    createdByUserId: params.createdByUserId,
    teamId: params.teamId,
    contractTemplateId: params.contractTemplateId,
    contractStartDate: params.contractStartDate,
    targetRole: "STAFF",
  });
}

// チームマネージャー/リーダーとして新規に招待する（設定＞チーム管理の
// 「＋招待」専用）。通常のinviteStaffと違い、参加した時点でチームの
// 役職を持つ状態になる。
export async function inviteTeamManager(params: {
  companyId: string;
  createdByUserId: string;
  teamId: string;
  teamRole: TeamRole;
}) {
  return createInvite({
    kind: "STAFF",
    companyId: params.companyId,
    createdByUserId: params.createdByUserId,
    teamId: params.teamId,
    targetRole: "STAFF",
    targetTeamRole: params.teamRole,
  });
}

// 仮アカウントを作成: a name-only placeholder staff member with no real
// login yet. Tagged isProxy so it can later be linked to a real account via
// a "本アカウントと連携する" invite (see inviteProxyUpgrade below).
export async function createProxyStaff(params: {
  companyId: string;
  createdByUserId: string;
  name: string;
  teamId?: string;
}) {
  const placeholderEmail = `proxy-${randomBytes(8).toString("hex")}@proxy.teera.internal`;
  const unusablePasswordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: params.name,
        email: placeholderEmail,
        passwordHash: unusablePasswordHash,
        isProxy: true,
      },
    });
    await tx.companyMembership.create({
      data: { userId: user.id, companyId: params.companyId, role: "STAFF" },
    });
    if (params.teamId) {
      await tx.teamMembership.create({
        data: { userId: user.id, teamId: params.teamId, role: "TEAM_MEMBER" },
      });
    }
    return user;
  });
}

// スタッフ情報の削除 — 間違えて仮アカウントを二重作成してしまった場合の
// 取り消し用。本アカウント（実際にログインする本人のアカウント）と、
// 稼働実績（シフト・配属）が一件でもある仮アカウントは対象外 — 給与・請求の
// 実績データを巻き込んで消してしまわないようにする。所属チームや契約・
// 単価テーブル自体は単なる設定情報なのでブロックせずcascadeで一緒に消える
// （Userに対する全リレーションがonDelete: Cascade — schema.prisma参照）。
export async function deleteStaff(params: { companyId: string; staffUserId: string }) {
  const membership = await prisma.companyMembership.findFirstOrThrow({
    where: { userId: params.staffUserId, companyId: params.companyId, role: "STAFF" },
    include: { user: true },
  });
  if (!membership.user.isProxy) throw new Error("not_proxy");

  const [shiftCount, placementCount] = await Promise.all([
    prisma.shift.count({ where: { staffUserId: params.staffUserId } }),
    prisma.staffPlacement.count({ where: { staffUserId: params.staffUserId } }),
  ]);
  if (shiftCount > 0 || placementCount > 0) throw new Error("has_shifts");

  await prisma.user.delete({ where: { id: params.staffUserId } });
}

export async function inviteProxyUpgrade(params: {
  proxyUserId: string;
  companyId: string;
  createdByUserId: string;
}) {
  const membership = await prisma.companyMembership.findFirst({
    where: { userId: params.proxyUserId, companyId: params.companyId },
  });
  if (!membership) throw new Error("proxy_membership_not_found");

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  return prisma.inviteToken.create({
    data: {
      token,
      kind: "STAFF",
      companyId: params.companyId,
      targetRole: "STAFF",
      upgradeProxyUserId: params.proxyUserId,
      createdByUserId: params.createdByUserId,
      expiresAt,
    },
  });
}

// スタッフ詳細パネルの稼働履歴タブ: 対象月のシフト×業務報告を日付ごとにまとめる。
export async function getStaffMonthDetail(params: {
  companyId: string;
  userId: string;
  year: number;
  month: number;
}) {
  const membership = await prisma.companyMembership.findFirstOrThrow({
    where: { userId: params.userId, companyId: params.companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }] },
    include: { user: true },
  });
  const teamMemberships = await prisma.teamMembership.findMany({
    where: { userId: params.userId, team: { companyId: params.companyId } },
    include: { team: true },
  });

  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  const shifts = await prisma.shift.findMany({
    where: {
      companyId: params.companyId,
      staffUserId: params.userId,
      date: { gte: start, lt: end },
      status: { notIn: ["SUPERSEDED", "CANCELLED"] },
    },
    include: { workReport: true, companyRelationship: { include: { clientCompany: true } } },
    orderBy: { date: "asc" },
  });

  // 承認済みの実績のみを集計する（スタッフ名簿の「今月稼働」列・実際の給料
  // 計算と同じ基準）。未承認・差戻しの申告分をここで合算してしまうと、
  // 承認前の自己申告がそのまま数字として確定しているように見えてしまう。
  const approvedReports = shifts.filter((s) => s.workReport?.approvalStatus === "APPROVED");
  const hours = approvedReports.reduce((sum, s) => sum + (s.workReport?.computedMinutes ?? 0) / 60, 0);
  const daysWorked = new Set(approvedReports.map((s) => s.date.toISOString().slice(0, 10))).size;

  const contracts = await prisma.staffContract.findMany({
    where: { staffUserId: params.userId, template: { companyId: params.companyId } },
    include: {
      template: { include: { companyRelationship: { include: { clientCompany: true } } } },
      wageVersions: { orderBy: { effectiveFrom: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const taskRates = await prisma.staffTaskRate.findMany({
    where: { companyId: params.companyId, staffUserId: params.userId },
    include: {
      versions: { orderBy: { effectiveFrom: "desc" } },
      companyRelationship: { include: { clientCompany: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  // effectiveFromはJST日付を"YYYY-MM-DDT00:00:00.000Z"として保存している
  // ため、比較対象の「今日」もJST日付の終わり(23:59:59.999Z)にしないと、
  // サーバーのUTC時刻がまだ前日のうちは「今日」から始まる単価が未来日
  // 扱いになり、設定した直後でも反映されない（JST 00:00〜09:00に発生）。
  const today = new Date(`${todayJst()}T23:59:59.999Z`);

  // 全期間で実際にシフト実績のある依頼主 — 業務内容単価タブの「勤務先」
  // 選択肢を、よく使う依頼主が上に来るよう並び替えるためだけに使う
  // （絞り込みはしない。まだ一度も働いていない依頼主向けに先回りで単価を
  // 登録しておきたい場面もあるため）。
  const workedRelationships = await prisma.shift.findMany({
    where: { companyId: params.companyId, staffUserId: params.userId, companyRelationshipId: { not: null } },
    select: { companyRelationshipId: true },
    distinct: ["companyRelationshipId"],
  });
  const workedClientIds = workedRelationships
    .map((s) => s.companyRelationshipId)
    .filter((id): id is string => id !== null);

  const staffNotes = await listStaffNotes(membership.id);

  return {
    membershipId: membership.id,
    name: membership.user.name,
    isProxy: membership.user.isProxy,
    staffNotes: staffNotes.map((n) => ({
      id: n.id,
      content: n.content,
      authorName: n.author.name,
      createdAt: n.createdAt.toISOString().slice(0, 10),
    })),
    teams: teamMemberships.map((tm) => ({ teamId: tm.teamId, teamName: tm.team.name, role: tm.role })),
    monthlyHours: Math.round(hours * 10) / 10,
    daysWorked,
    workedClientIds,
    idDocumentFrontUrl: membership.idDocumentFrontUrl,
    idDocumentBackUrl: membership.idDocumentBackUrl,
    bankInfo: {
      bankName: membership.bankName ?? "",
      branchName: membership.branchName ?? "",
      accountType: membership.accountType ?? "",
      accountNumber: membership.accountNumber ?? "",
      accountHolderName: membership.accountHolderName ?? "",
    },
    contracts: contracts.map((c) => {
      const currentWage = resolveContractWageVersion(c.wageVersions, today) ?? {
        wageAmount: c.wageAmountSnapshot,
        effectiveFrom: c.contractStartDate ?? c.template.contractStartDate,
      };
      return {
        id: c.id,
        title: c.template.title,
        status: c.status,
        wageType: c.template.wageType,
        wageAmount: currentWage.wageAmount,
        wageLabel: `${WAGE_TYPE_LABEL[c.template.wageType]}${currentWage.wageAmount}円`,
        employmentTypeLabel: EMPLOYMENT_TYPE_LABEL[c.template.employmentType] ?? c.template.employmentType,
        jobDescription: c.template.jobDescription,
        workplaceName:
          c.template.workplaceType === "CLIENT"
            ? c.template.workplaceNote ??
              c.template.companyRelationship?.clientCompany?.name ??
              c.template.companyRelationship?.proxyName ??
              "配属先"
            : "自社",
        contractStartDate: (c.contractStartDate ?? c.template.contractStartDate).toISOString().slice(0, 10),
        contractEndDate: (c.contractEndDate ?? c.template.contractEndDate)?.toISOString().slice(0, 10) ?? null,
        noticeGivenAt: c.noticeGivenAt?.toISOString().slice(0, 10) ?? null,
        wageVersions: c.wageVersions.map((v) => ({
          id: v.id,
          label: `${WAGE_TYPE_LABEL[c.template.wageType]}${v.wageAmount}円`,
          effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
        })),
        // 「詳細確認」ポップアップ用 — ContractsView.tsxのTemplateModalを
        // readOnlyで開くための、Template型と同じ形。
        templateDetail: {
          id: c.template.id,
          title: c.template.title,
          employmentType: c.template.employmentType,
          workplaceType: c.template.workplaceType,
          workplaceNote: c.template.workplaceNote,
          clientName: c.template.companyRelationship?.clientCompany?.name ?? c.template.companyRelationship?.proxyName ?? null,
          jobDescription: c.template.jobDescription,
          scheduleType: c.template.scheduleType,
          workStartTime: c.template.workStartTime,
          workEndTime: c.template.workEndTime,
          actualWorkMinutes: c.template.actualWorkMinutes,
          breakMinutes: c.template.breakMinutes,
          hasOvertime: c.template.hasOvertime,
          overtimeNote: c.template.overtimeNote,
          fixedWeekdays: c.template.fixedWeekdays,
          shiftPatternNote: c.template.shiftPatternNote,
          restNote: c.template.restNote,
          wageType: c.template.wageType,
          wageAmount: c.template.wageAmount,
          paymentClosingDay: c.template.paymentClosingDay,
          paymentDay: c.template.paymentDay,
          paymentMethod: c.template.paymentMethod,
          contractPeriodType: c.template.contractPeriodType,
          contractStartDate: c.template.contractStartDate.toISOString().slice(0, 10),
          contractEndDate: c.template.contractEndDate?.toISOString().slice(0, 10) ?? null,
          extraItems: c.template.extraItems as { label: string; value: string }[],
          status: c.template.status,
          contractedStaffNames: [] as string[],
        },
      };
    }),
    taskRates: taskRates.map((r) => {
      const current = resolveRateVersion(r.versions, today);
      return {
        id: r.id,
        taskName: r.taskName,
        companyRelationshipId: r.companyRelationshipId,
        workplaceLabel: r.companyRelationshipId
          ? (r.companyRelationship?.clientCompany?.name ?? r.companyRelationship?.proxyName ?? "取引先")
          : "勤務先問わず",
        currentLabel: current ? `${WAGE_TYPE_LABEL[current.wageType]}${current.amount}円` : "単価未設定",
        versions: r.versions.map((v) => ({
          id: v.id,
          label: v.wageType && v.amount != null ? `${WAGE_TYPE_LABEL[v.wageType]}${v.amount}円` : "単価未設定（終了）",
          effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
        })),
      };
    }),
    days: shifts.map((s) => ({
      shiftId: s.id,
      date: s.date.toISOString().slice(0, 10),
      startTime: s.startTime,
      endTime: s.endTime,
      isAllDay: s.isAllDay,
      isUndecided: s.isUndecided,
      approvalStatus: s.workReport?.approvalStatus ?? null,
      outcome: s.workReport?.outcome ?? null,
      actualStartTime: s.workReport?.clockIn ? formatJstTime(s.workReport.clockIn) : null,
      actualEndTime: s.workReport?.clockOut ? formatJstTime(s.workReport.clockOut) : null,
      comment: s.workReport?.comment ?? null,
      taskName: s.workReport?.taskName ?? s.taskName,
      workplaceLabel:
        s.source === "INHOUSE"
          ? "自社"
          : (s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? "取引先"),
    })),
  };
}

// 情報メモ: 誰がいつ書いたか分かるよう追記式の一覧で持つ。更新はなく、
// 削除のみ（誤記は削除して書き直す）。
export async function listStaffNotes(membershipId: string) {
  return prisma.staffNote.findMany({
    where: { membershipId },
    include: { author: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function addStaffNote(params: { membershipId: string; authorUserId: string; content: string }) {
  const content = params.content.trim();
  if (!content) throw new Error("empty_content");
  return prisma.staffNote.create({
    data: { membershipId: params.membershipId, authorUserId: params.authorUserId, content },
  });
}

export async function deleteStaffNote(id: string) {
  return prisma.staffNote.delete({ where: { id } });
}

// 本人確認書類（表面・裏面）。契約ごとではなく所属（会社との関係）単位で
// 1組だけ持つ。スタッフ本人・会社どちらのアクションからも呼ばれる。
export async function updateMembershipIdDocument(params: {
  membershipId: string;
  side: "front" | "back";
  url: string;
}) {
  return prisma.companyMembership.update({
    where: { id: params.membershipId },
    data: params.side === "front" ? { idDocumentFrontUrl: params.url } : { idDocumentBackUrl: params.url },
  });
}

// 振込先情報 — 上書き式（履歴は持たない）。会社側・スタッフ側どちらからも
// 更新できる。
export async function updateMembershipBankInfo(params: {
  membershipId: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolderName: string;
}) {
  return prisma.companyMembership.update({
    where: { id: params.membershipId },
    data: {
      bankName: params.bankName.trim() || null,
      branchName: params.branchName.trim() || null,
      accountType: params.accountType.trim() || null,
      accountNumber: params.accountNumber.trim() || null,
      accountHolderName: params.accountHolderName.trim() || null,
    },
  });
}

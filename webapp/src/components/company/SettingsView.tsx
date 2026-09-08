"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateCompanyNameAction,
  updateCompanyInvoiceRegistrationNumberAction,
  updateCompanyAddressAction,
  updateCompanyPhoneNumberAction,
  setCompanyMemberRoleAction,
  setMemberCanWorkShiftsAction,
  removeCompanyMemberRoleAction,
  inviteCompanyAdminAction,
  createTeamAction,
  setTeamMemberRoleAction,
  inviteTeamManagerAction,
  promoteExistingStaffToTeamRoleAction,
} from "@/app/company/actions";
import { createSubscriptionCheckoutSessionAction } from "@/app/company/settings/subscriptionActions";
import { ContractsView } from "@/components/company/ContractsView";
import { WorkReportsQueue } from "@/components/company/WorkReportsQueue";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyUrlField } from "@/components/CopyUrlField";

type Admin = {
  userId: string;
  name: string;
  email: string;
  role: "COMPANY_ADMIN" | "COMPANY_EDITOR";
  canWorkShifts: boolean;
};

type TeamMember = { userId: string; name: string; email: string; role: string };
type Team = { id: string; name: string; members: TeamMember[] };
type StaffOption = { userId: string; name: string };

// 2チーム目以降の作成コスト。src/lib/domain/teams.tsのTEAM_UNLOCK_TEE_COSTと
// 同値（"server-only"ファイルのためクライアント側では値のみ複製）。
const TEAM_UNLOCK_TEE_COST = 10;

// src/lib/domain/plans.tsのPLAN_YEN/PLAN_PDF_QUOTAと同値の複製（同上）。
const PLAN_INFO: Record<"STANDARD" | "BUSINESS", { label: string; yen: number; quota: number }> = {
  STANDARD: { label: "スタンダード", yen: 3980, quota: 30 },
  BUSINESS: { label: "ビジネス", yen: 7980, quota: 100 },
};

type ContractTemplate = {
  id: string;
  title: string;
  employmentType: string;
  workplaceType: string;
  workplaceNote: string | null;
  clientName: string | null;
  jobDescription: string;
  scheduleType: string;
  workStartTime: string | null;
  workEndTime: string | null;
  actualWorkMinutes: number | null;
  breakMinutes: number | null;
  hasOvertime: boolean;
  overtimeNote: string | null;
  fixedWeekdays: number[];
  shiftPatternNote: string | null;
  restNote: string | null;
  wageType: string;
  wageAmount: number;
  paymentClosingDay: string | null;
  paymentDay: string | null;
  paymentMethod: string | null;
  contractPeriodType: string;
  contractStartDate: string;
  contractEndDate: string | null;
  extraItems: { label: string; value: string }[];
  status: string;
  contractedStaffNames: string[];
};
type ContractClientOption = { id: string; name: string };

type WorkReportRow = {
  id: string;
  staffName: string;
  outcome: string;
  date: string;
  computedHours: string;
  comment: string | null;
  taskName: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  breakMinutes: number;
};

const TABS = [
  { key: "basic", label: "基本情報" },
  { key: "contracts", label: "契約関連" },
  { key: "workreports", label: "業務報告" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function SettingsView({
  initialTab,
  companyName,
  invoiceRegistrationNumber,
  address,
  phoneNumber,
  admins,
  teams,
  staff,
  teeBalance,
  planTier,
  stripeConfigured,
  contractTemplates,
  contractClients,
  workReports,
}: {
  initialTab: string;
  companyName: string;
  invoiceRegistrationNumber: string;
  address: string;
  phoneNumber: string;
  admins: Admin[];
  teams: Team[];
  staff: StaffOption[];
  teeBalance: number;
  planTier: "FREE" | "STANDARD" | "BUSINESS";
  stripeConfigured: boolean;
  contractTemplates: ContractTemplate[];
  contractClients: ContractClientOption[];
  workReports: WorkReportRow[];
}) {
  const router = useRouter();
  const tab: TabKey = TABS.some((t) => t.key === initialTab) ? (initialTab as TabKey) : "basic";

  return (
    <div>
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">設定</h1>
      <div className="mb-8 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => router.push(`?tab=${t.key}`)}
            className={`border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === t.key ? "border-accent text-primary" : "border-transparent text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "basic" ? (
        <div className="flex flex-col gap-10">
          <CompanyInfoSection
            companyName={companyName}
            invoiceRegistrationNumber={invoiceRegistrationNumber}
            address={address}
            phoneNumber={phoneNumber}
          />
          <AdminsSection admins={admins} />
          <PlanSection planTier={planTier} stripeConfigured={stripeConfigured} />
          <TeamsSection teams={teams} staff={staff} teeBalance={teeBalance} />
        </div>
      ) : null}

      {tab === "contracts" ? (
        <ContractsView templates={contractTemplates} clients={contractClients} companyName={companyName} />
      ) : null}

      {tab === "workreports" ? <WorkReportsQueue reports={workReports} /> : null}
    </div>
  );
}

function SectionCard({
  title,
  headerAction,
  children,
}: {
  title: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-jp text-lg font-bold text-primary">{title}</h2>
        {headerAction}
      </div>
      {children}
    </section>
  );
}

const PLAN_LABEL: Record<"FREE" | "STANDARD" | "BUSINESS", string> = {
  FREE: "無料",
  STANDARD: "スタンダード",
  BUSINESS: "ビジネス",
};

function PlanSection({
  planTier,
  stripeConfigured,
}: {
  planTier: "FREE" | "STANDARD" | "BUSINESS";
  stripeConfigured: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const upgradeTargets = (["STANDARD", "BUSINESS"] as const).filter((t) => t !== planTier);

  return (
    <SectionCard title="プラン">
      <p className="mb-4 text-sm">
        現在のプラン: <span className="font-semibold text-primary">{PLAN_LABEL[planTier]}</span>
        {planTier === "FREE" ? (
          <span className="ml-2 text-xs text-muted">過去データの閲覧は直近3ヶ月までです。</span>
        ) : (
          <span className="ml-2 text-xs text-muted">
            過去データ閲覧が無制限、PDF発行が月{PLAN_INFO[planTier].quota}件まで無料です。
          </span>
        )}
      </p>

      {upgradeTargets.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {upgradeTargets.map((tier) => (
            <div key={tier} className="rounded-xl border border-border p-4">
              <p className="font-semibold text-foreground">{PLAN_INFO[tier].label}プラン</p>
              <p className="mt-1 text-xs text-muted">
                月額{PLAN_INFO[tier].yen.toLocaleString()}円 / PDF発行 月{PLAN_INFO[tier].quota}件まで無料
              </p>
              <button
                type="button"
                disabled={pending || !stripeConfigured}
                onClick={() => startTransition(() => createSubscriptionCheckoutSessionAction(tier))}
                className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {PLAN_INFO[tier].label}にアップグレード
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {!stripeConfigured ? (
        <p className="mt-3 text-xs text-red-600">Stripeが未設定のため、プランのアップグレードは利用できません。</p>
      ) : null}
    </SectionCard>
  );
}

function CompanyInfoSection({
  companyName,
  invoiceRegistrationNumber,
  address,
  phoneNumber,
}: {
  companyName: string;
  invoiceRegistrationNumber: string;
  address: string;
  phoneNumber: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(companyName);
  const [regNumber, setRegNumber] = useState(invoiceRegistrationNumber);
  const [addressValue, setAddressValue] = useState(address);
  const [phoneValue, setPhoneValue] = useState(phoneNumber);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <SectionCard title="会社情報">
        <div className="flex items-center justify-between">
          <div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-muted">会社名</p>
              <p className="font-medium">{name}</p>
            </div>
            <div>
              <p className="text-xs text-muted">住所</p>
              <p className="font-medium">{addressValue || "未登録"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">電話番号</p>
              <p className="font-medium">{phoneValue || "未登録"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">登録番号（インボイス番号）</p>
              <p className="font-medium">{regNumber || "未登録"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-accent bg-accent/20 px-4 py-2 text-sm font-semibold text-primary"
          >
            <span className="inline-block scale-x-[-1]">✎</span> 変更
          </button>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="会社情報">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs">
          会社名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          住所
          <input
            type="text"
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          電話番号
          <input
            type="text"
            value={phoneValue}
            onChange={(e) => setPhoneValue(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          登録番号（インボイス番号）
          <input
            type="text"
            value={regNumber}
            onChange={(e) => setRegNumber(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await updateCompanyNameAction(name);
                await updateCompanyInvoiceRegistrationNumberAction(regNumber);
                await updateCompanyAddressAction(addressValue);
                await updateCompanyPhoneNumberAction(phoneValue);
                setEditing(false);
              })
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-border px-4 py-2 text-sm"
          >
            キャンセル
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

function AdminsSection({ admins }: { admins: Admin[] }) {
  const [pending, startTransition] = useTransition();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeConfirmTarget, setRemoveConfirmTarget] = useState<{ userId: string; name: string } | null>(null);
  const adminCount = admins.filter((a) => a.role === "COMPANY_ADMIN").length;

  return (
    <SectionCard title="本部メンバー権限">
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">氏名</th>
            <th className="py-2">メール</th>
            <th className="py-2">権限</th>
            <th className="py-2">兼務</th>
            <th className="py-2">権限を外す</th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => {
            const isLastAdmin = a.role === "COMPANY_ADMIN" && adminCount <= 1;
            return (
              <tr key={a.userId} className="border-b border-border/60">
                <td className="py-2">{a.name}</td>
                <td className="py-2 text-muted">{a.email}</td>
                <td className="py-2">
                  <select
                    defaultValue={a.role}
                    disabled={pending}
                    onChange={(e) =>
                      startTransition(() =>
                        setCompanyMemberRoleAction(
                          a.userId,
                          e.target.value as "COMPANY_ADMIN" | "COMPANY_EDITOR",
                        ),
                      )
                    }
                    className="rounded-lg border border-border px-2 py-1 text-sm"
                  >
                    <option value="COMPANY_ADMIN">本部管理者</option>
                    <option value="COMPANY_EDITOR">本部編集者</option>
                  </select>
                </td>
                <td className="py-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      defaultChecked={a.canWorkShifts}
                      disabled={pending}
                      onChange={(e) =>
                        startTransition(() => setMemberCanWorkShiftsAction(a.userId, e.target.checked))
                      }
                    />
                    このメンバーはシフトにも入れる
                  </label>
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    disabled={pending || isLastAdmin}
                    title={isLastAdmin ? "本部管理者は最低1名必要です" : undefined}
                    onClick={() => setRemoveConfirmTarget({ userId: a.userId, name: a.name })}
                    className="text-xs text-muted hover:text-red-600 disabled:opacity-40"
                  >
                    権限を外す
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {removeConfirmTarget ? (
        <ConfirmDialog
          message={`「${removeConfirmTarget.name}」の本部管理者/編集者権限を外し、一般スタッフに戻します。よろしいですか？`}
          confirmLabel="権限を外す"
          pending={pending}
          onConfirm={() =>
            startTransition(async () => {
              setError(null);
              const result = await removeCompanyMemberRoleAction(removeConfirmTarget.userId);
              if (result.error) setError("本部管理者は最低1名必要なため、外せませんでした。");
              setRemoveConfirmTarget(null);
            })
          }
          onCancel={() => setRemoveConfirmTarget(null)}
        />
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const url = await inviteCompanyAdminAction("COMPANY_EDITOR");
              setInviteUrl(url);
            })
          }
          className="rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
        >
          ＋招待
        </button>
      </div>
      {inviteUrl ? (
        <div className="mt-3">
          <CopyUrlField url={inviteUrl} />
        </div>
      ) : null}
    </SectionCard>
  );
}

function TeamsSection({
  teams,
  staff,
  teeBalance,
}: {
  teams: Team[];
  staff: StaffOption[];
  teeBalance: number;
}) {
  const [pending, startTransition] = useTransition();
  const [inviteFormTeamId, setInviteFormTeamId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [removeConfirmTarget, setRemoveConfirmTarget] = useState<{ teamId: string; userId: string; name: string } | null>(
    null,
  );

  const nextTeamRequiresTee = teams.length > 0;
  const canAffordNextTeam = !nextTeamRequiresTee || teeBalance >= TEAM_UNLOCK_TEE_COST;

  return (
    <SectionCard
      title="チーム管理"
      headerAction={
        <button
          type="button"
          disabled={!canAffordNextTeam}
          onClick={() => setShowCreateModal(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          ＋チームを作成
        </button>
      }
    >
      <p className="mb-1 text-xs text-muted">
        ここに載るのはチームのマネージャー/リーダーだけです。一般スタッフのチーム所属はスタッフ名簿の各スタッフ詳細から、依頼主/派遣会社との紐付けは各企業詳細から変更できます。
      </p>
      <p className="mb-4 text-xs text-muted">
        1チーム目は無料、2チーム目以降は1チームにつき{TEAM_UNLOCK_TEE_COST} Teeで作成できます（プラン不問）。
        {nextTeamRequiresTee && !canAffordNextTeam ? (
          <span className="ml-1 text-red-600">Tee残高が不足しています（残高: {teeBalance} Tee）。</span>
        ) : null}
      </p>

      <div className="flex flex-col gap-6">
        {teams.map((team) => {
          const managers = team.members.filter((m) => m.role === "TEAM_MANAGER" || m.role === "TEAM_LEADER");
          return (
          <div key={team.id} className="rounded-xl border border-border p-4">
            <div className="mb-3 font-semibold">{team.name}</div>

            {managers.length > 0 ? (
              <table className="mb-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-2">氏名</th>
                    <th className="py-2">メール</th>
                    <th className="py-2">権限</th>
                    <th className="py-2">権限を外す</th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map((m) => (
                    <tr key={m.userId} className="border-b border-border/60">
                      <td className="py-2">{m.name}</td>
                      <td className="py-2 text-muted">{m.email}</td>
                      <td className="py-2">
                        <select
                          defaultValue={m.role}
                          disabled={pending}
                          onChange={(e) =>
                            startTransition(() =>
                              setTeamMemberRoleAction(
                                team.id,
                                m.userId,
                                e.target.value as "TEAM_MANAGER" | "TEAM_LEADER",
                              ),
                            )
                          }
                          className="rounded-lg border border-border px-2 py-1 text-xs"
                        >
                          <option value="TEAM_MANAGER">マネージャー</option>
                          <option value="TEAM_LEADER">リーダー</option>
                        </select>
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setRemoveConfirmTarget({ teamId: team.id, userId: m.userId, name: m.name })}
                          className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
                        >
                          権限を外す
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mb-2 text-xs text-muted">まだマネージャー/リーダーがいません。</p>
            )}

            <div className="mt-3 border-t border-border pt-3">
              {inviteFormTeamId === team.id ? (
                <TeamInviteForm
                  teamId={team.id}
                  staffOptions={staff.filter((s) => !team.members.some((m) => m.userId === s.userId))}
                  onDone={() => setInviteFormTeamId(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setInviteFormTeamId(team.id)}
                  className="rounded-lg border border-primary px-3 py-1.5 text-xs text-primary"
                >
                  ＋招待
                </button>
              )}
            </div>

          </div>
          );
        })}
        {teams.length === 0 ? (
          <p className="text-xs text-muted">チームはまだありません。</p>
        ) : null}
      </div>

      {showCreateModal ? (
        <CreateTeamModal
          staff={staff}
          teeCost={nextTeamRequiresTee ? TEAM_UNLOCK_TEE_COST : 0}
          onClose={() => setShowCreateModal(false)}
        />
      ) : null}

      {removeConfirmTarget ? (
        <ConfirmDialog
          message={`「${removeConfirmTarget.name}」のチーム管理者/リーダー権限を外します。よろしいですか？`}
          confirmLabel="権限を外す"
          pending={pending}
          onConfirm={() =>
            startTransition(async () => {
              await setTeamMemberRoleAction(removeConfirmTarget.teamId, removeConfirmTarget.userId, "TEAM_MEMBER");
              setRemoveConfirmTarget(null);
            })
          }
          onCancel={() => setRemoveConfirmTarget(null)}
        />
      ) : null}
    </SectionCard>
  );
}

function CreateTeamModal({
  staff,
  teeCost,
  onClose,
}: {
  staff: StaffOption[];
  teeCost: number;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [role, setRole] = useState<"TEAM_MANAGER" | "TEAM_LEADER">("TEAM_MANAGER");

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">チームを作成</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        <label className="mb-4 flex flex-col gap-1 text-xs text-muted">
          チーム名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="新しいチーム名"
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="mb-1 flex flex-col gap-1 text-xs text-muted">
          担当者（任意）
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
          >
            <option value="">割り当てない</option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {assigneeId ? (
          <label className="mb-4 mt-2 flex flex-col gap-1 text-xs text-muted">
            権限
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "TEAM_MANAGER" | "TEAM_LEADER")}
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
            >
              <option value="TEAM_MANAGER">マネージャー</option>
              <option value="TEAM_LEADER">リーダー</option>
            </select>
          </label>
        ) : (
          <div className="mb-4" />
        )}

        {teeCost > 0 ? (
          <p className="mb-3 text-xs text-muted">このチームの作成に{teeCost} Teeを消費します。</p>
        ) : null}

        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() =>
            startTransition(async () => {
              await createTeamAction(name.trim(), assigneeId ? { userId: assigneeId, role } : undefined);
              onClose();
            })
          }
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          作成
        </button>
      </div>
    </div>
  );
}

function TeamInviteForm({
  teamId,
  staffOptions,
  onDone,
}: {
  teamId: string;
  staffOptions: StaffOption[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [role, setRole] = useState<"TEAM_MANAGER" | "TEAM_LEADER">("TEAM_MANAGER");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState(staffOptions[0]?.userId ?? "");

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
      <div className="mb-3 inline-flex rounded-lg border border-border bg-white p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setMode("new")}
          className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
            mode === "new" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          新しく招待する
        </button>
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${
            mode === "existing" ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          既存スタッフから選ぶ
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {mode === "existing" ? (
          staffOptions.length === 0 ? (
            <p className="text-xs text-muted">追加できる既存スタッフがいません。</p>
          ) : (
            <label className="flex flex-col gap-0.5 text-xs text-muted">
              スタッフ
              <select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="rounded-lg border border-border px-2 py-1.5 text-sm"
              >
                {staffOptions.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : null}

        <label className="flex flex-col gap-0.5 text-xs text-muted">
          権限
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "TEAM_MANAGER" | "TEAM_LEADER")}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          >
            <option value="TEAM_MANAGER">マネージャー</option>
            <option value="TEAM_LEADER">リーダー</option>
          </select>
        </label>

        {mode === "new" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const url = await inviteTeamManagerAction(teamId, role);
                setInviteUrl(url);
              })
            }
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            招待URLを発行する
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || !selectedStaffId}
            onClick={() =>
              startTransition(async () => {
                await promoteExistingStaffToTeamRoleAction(teamId, selectedStaffId, role);
                onDone();
              })
            }
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            追加する
          </button>
        )}
        <button type="button" onClick={onDone} className="rounded-lg border border-border px-3 py-1.5 text-xs">
          キャンセル
        </button>
      </div>

      {inviteUrl ? (
        <div className="mt-2">
          <CopyUrlField url={inviteUrl} size="sm" />
        </div>
      ) : null}
    </div>
  );
}

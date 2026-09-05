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
  inviteCompanyAdminAction,
  createTeamAction,
  setTeamMemberRoleAction,
  inviteTeamManagerAction,
  promoteExistingStaffToTeamRoleAction,
} from "@/app/company/actions";
import { ContractsView } from "@/components/company/ContractsView";
import { WorkReportsQueue } from "@/components/company/WorkReportsQueue";

type Admin = {
  userId: string;
  name: string;
  email: string;
  role: "COMPANY_ADMIN" | "COMPANY_EDITOR";
  canWorkShifts: boolean;
};

type TeamMember = { userId: string; name: string; role: string };
type Team = { id: string; name: string; members: TeamMember[] };
type StaffOption = { userId: string; name: string };

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
          <TeamsSection teams={teams} staff={staff} />
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
      <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">
        {title}
      </h2>
      {children}
    </section>
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

  return (
    <SectionCard title="本部メンバー権限">
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">氏名</th>
            <th className="py-2">メール</th>
            <th className="py-2">権限</th>
            <th className="py-2">兼務</th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => (
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
            </tr>
          ))}
        </tbody>
      </table>

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
        <p className="mt-3 truncate rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm">
          招待URL: {inviteUrl}
        </p>
      ) : null}
    </SectionCard>
  );
}

function TeamsSection({
  teams,
  staff,
}: {
  teams: Team[];
  staff: StaffOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [newTeamName, setNewTeamName] = useState("");
  const [inviteFormTeamId, setInviteFormTeamId] = useState<string | null>(null);

  return (
    <SectionCard title="チーム管理">
      <p className="mb-4 text-xs text-muted">
        ここに載るのはチームのマネージャー/リーダーだけです。一般スタッフのチーム所属はスタッフ名簿の各スタッフ詳細から、依頼主/派遣会社との紐付けは各企業詳細から変更できます。
      </p>
      <div className="mb-6 flex items-center gap-3">
        <input
          type="text"
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          placeholder="新しいチーム名"
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={pending || !newTeamName.trim()}
          onClick={() =>
            startTransition(async () => {
              await createTeamAction(newTeamName.trim());
              setNewTeamName("");
            })
          }
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          ＋チームを作成
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {teams.map((team) => {
          const managers = team.members.filter((m) => m.role === "TEAM_MANAGER" || m.role === "TEAM_LEADER");
          return (
          <div key={team.id} className="rounded-xl border border-border p-4">
            <div className="mb-3 font-semibold">{team.name}</div>
            <div className="flex flex-col gap-2">
              {managers.map((m) => (
                <div key={m.userId} className="flex items-center justify-between text-sm">
                  <span>{m.name}</span>
                  <div className="flex items-center gap-2">
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
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => startTransition(() => setTeamMemberRoleAction(team.id, m.userId, "TEAM_MEMBER"))}
                      className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
                    >
                      権限を外す
                    </button>
                  </div>
                </div>
              ))}
              {managers.length === 0 ? (
                <p className="text-xs text-muted">まだマネージャー/リーダーがいません。</p>
              ) : null}
            </div>

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
    </SectionCard>
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
      <div className="mb-2 flex gap-3 text-xs">
        <button
          type="button"
          onClick={() => setMode("new")}
          className={mode === "new" ? "font-semibold text-primary" : "text-muted"}
        >
          新しく招待する
        </button>
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={mode === "existing" ? "font-semibold text-primary" : "text-muted"}
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
        <p className="mt-2 truncate rounded-lg border border-accent bg-accent/10 px-3 py-2 text-xs">招待URL: {inviteUrl}</p>
      ) : null}
    </div>
  );
}

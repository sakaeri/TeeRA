"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateCompanyNameAction,
  updateCompanyInvoiceRegistrationNumberAction,
  updateCompanyAddressAction,
  updateCompanyPhoneNumberAction,
  updateCompanyNotificationEmailAction,
  updateCompanyBankInfoAction,
  setCompanyMemberRoleAction,
  setMemberCanWorkShiftsAction,
  removeCompanyMemberRoleAction,
  inviteCompanyAdminAction,
  createTeamAction,
  updateTeamNameAction,
  updateTeamNotificationEmailAction,
  setTeamMemberRoleAction,
  inviteTeamManagerAction,
  promoteExistingStaffToTeamRoleAction,
} from "@/app/company/actions";
import { ContractsView } from "@/components/company/ContractsView";
import { WorkReportsQueue } from "@/components/company/WorkReportsQueue";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyUrlField } from "@/components/CopyUrlField";
import { useClickOutside } from "@/lib/useClickOutside";

type Admin = {
  userId: string;
  name: string;
  email: string;
  role: "COMPANY_ADMIN" | "COMPANY_EDITOR";
  canWorkShifts: boolean;
};

type TeamMember = { userId: string; name: string; email: string; role: string };
type Team = { id: string; name: string; notificationEmail: string; members: TeamMember[] };
type StaffOption = { userId: string; name: string };

// 2チーム目以降の作成コスト。src/lib/domain/teams.tsのTEAM_UNLOCK_TEE_COSTと
// 同値（"server-only"ファイルのためクライアント側では値のみ複製）。
const TEAM_UNLOCK_TEE_COST = 10;

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
  { key: "howto", label: "使い方" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function SettingsView({
  initialTab,
  companyName,
  invoiceRegistrationNumber,
  address,
  phoneNumber,
  notificationEmail,
  bankName,
  branchName,
  accountType,
  accountNumber,
  accountHolderName,
  admins,
  teams,
  staff,
  teeBalance,
  contractTemplates,
  contractClients,
  workReports,
}: {
  initialTab: string;
  companyName: string;
  invoiceRegistrationNumber: string;
  address: string;
  phoneNumber: string;
  notificationEmail: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolderName: string;
  admins: Admin[];
  teams: Team[];
  staff: StaffOption[];
  teeBalance: number;
  contractTemplates: ContractTemplate[];
  contractClients: ContractClientOption[];
  workReports: WorkReportRow[];
}) {
  const router = useRouter();
  const tab: TabKey = TABS.some((t) => t.key === initialTab) ? (initialTab as TabKey) : "basic";

  return (
    <div>
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">設定</h1>
      <div className="mb-8 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => router.push(`?tab=${t.key}`)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
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
            notificationEmail={notificationEmail}
            bankName={bankName}
            branchName={branchName}
            accountType={accountType}
            accountNumber={accountNumber}
            accountHolderName={accountHolderName}
          />
          <AdminsSection admins={admins} />
          <TeamsSection teams={teams} staff={staff} teeBalance={teeBalance} />
        </div>
      ) : null}

      {tab === "contracts" ? (
        <ContractsView templates={contractTemplates} clients={contractClients} companyName={companyName} />
      ) : null}

      {tab === "workreports" ? <WorkReportsQueue reports={workReports} /> : null}

      {tab === "howto" ? <HowToSection /> : null}
    </div>
  );
}

function HowToSection() {
  return (
    <div className="flex flex-col gap-10">
      <SectionCard title="権限ごとに使える機能">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-4 font-semibold">役職</th>
                <th className="py-2 pr-4 font-semibold">シフト作成・管理</th>
                <th className="py-2 pr-4 font-semibold">給与計算・請求書・契約書</th>
                <th className="py-2 pr-4 font-semibold">スタッフ・取引先の追加</th>
                <th className="py-2 font-semibold">会社全体の設定</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="py-2 pr-4 font-semibold text-primary">本部管理者・本部編集者</td>
                <td className="py-2 pr-4">○（全社）</td>
                <td className="py-2 pr-4">○（全社）</td>
                <td className="py-2 pr-4">○（スタッフ・取引先・派遣会社とも）</td>
                <td className="py-2">○</td>
              </tr>
              <tr className="border-b border-border/60">
                <td className="py-2 pr-4 font-semibold text-primary">チームマネージャー</td>
                <td className="py-2 pr-4">○（自チーム内）</td>
                <td className="py-2 pr-4">○（自チーム内）</td>
                <td className="py-2 pr-4">スタッフのみ○（自チームに追加）</td>
                <td className="py-2">✕</td>
              </tr>
              <tr className="border-b border-border/60">
                <td className="py-2 pr-4 font-semibold text-primary">チームリーダー</td>
                <td className="py-2 pr-4">○（自チーム内）</td>
                <td className="py-2 pr-4">✕（閲覧も不可）</td>
                <td className="py-2 pr-4">✕</td>
                <td className="py-2">✕</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 font-semibold text-primary">スタッフ</td>
                <td className="py-2 pr-4">自分のシフト提出のみ</td>
                <td className="py-2 pr-4">✕</td>
                <td className="py-2 pr-4">✕</td>
                <td className="py-2">✕</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-4 list-disc pl-5 text-sm text-muted">
          <li>本部管理者と本部編集者の権限は同じです。ただし本部管理者が0人になる変更（最後の1人の降格・削除など）はできません。</li>
          <li>取引先・派遣会社の新規作成は本部管理者・編集者のみ行えます。仮アカウントを作成する際にチームを指定すれば、作成後すぐにそのチームに紐付けられます。</li>
        </ul>
      </SectionCard>

      <SectionCard title="スマートフォンのホーム画面に追加する">
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <p className="mb-1 font-semibold text-primary">iPhone（Safari）</p>
            <ol className="list-decimal pl-5 text-muted">
              <li>SafariでTeeRAを開く</li>
              <li>画面下の共有ボタン（□に↑）をタップ</li>
              <li>「ホーム画面に追加」を選び、「追加」をタップ</li>
            </ol>
          </div>
          <div>
            <p className="mb-1 font-semibold text-primary">Android（Chrome）</p>
            <ol className="list-decimal pl-5 text-muted">
              <li>ChromeでTeeRAを開く</li>
              <li>右上の「︙」メニューをタップ</li>
              <li>「アプリをインストール」または「ホーム画面に追加」を選ぶ</li>
            </ol>
          </div>
          <p className="text-muted">ホーム画面に追加すると、アプリのように起動でき、通知にもすぐ気づきやすくなります。</p>
        </div>
      </SectionCard>
    </div>
  );
}

function SectionCard({
  title,
  headerAction,
  children,
}: {
  title: React.ReactNode;
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

function CompanyInfoSection({
  companyName,
  invoiceRegistrationNumber,
  address,
  phoneNumber,
  notificationEmail,
  bankName,
  branchName,
  accountType,
  accountNumber,
  accountHolderName,
}: {
  companyName: string;
  invoiceRegistrationNumber: string;
  address: string;
  phoneNumber: string;
  notificationEmail: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolderName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(companyName);
  const [regNumber, setRegNumber] = useState(invoiceRegistrationNumber);
  const [addressValue, setAddressValue] = useState(address);
  const [phoneValue, setPhoneValue] = useState(phoneNumber);
  const [notificationEmailValue, setNotificationEmailValue] = useState(notificationEmail);
  const [bankNameValue, setBankNameValue] = useState(bankName);
  const [branchNameValue, setBranchNameValue] = useState(branchName);
  const [accountTypeValue, setAccountTypeValue] = useState(accountType);
  const [accountNumberValue, setAccountNumberValue] = useState(accountNumber);
  const [accountHolderNameValue, setAccountHolderNameValue] = useState(accountHolderName);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <SectionCard title="会社情報">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 sm:gap-x-10">
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
            <div>
              <p className="text-xs text-muted">通知メールアドレス</p>
              <p className="font-medium">{notificationEmailValue || "未設定（通知メールは送信されません）"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">請求書の振込先（デフォルト）</p>
              <p className="font-medium">
                {bankNameValue || accountNumberValue ? (
                  <>
                    {bankNameValue}
                    {branchNameValue ? ` ${branchNameValue}` : ""}
                    {accountTypeValue ? ` ${accountTypeValue}` : ""}
                    {accountNumberValue ? ` ${accountNumberValue}` : ""}
                    {accountHolderNameValue ? ` ${accountHolderNameValue}` : ""}
                  </>
                ) : (
                  "未登録"
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-lg border border-accent bg-accent/20 px-4 py-2 text-sm font-semibold text-primary"
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
        <label className="flex flex-col gap-1 text-xs">
          通知メールアドレス（業務報告の提出・シフト希望のたまり・販促品の受注をお知らせします。空欄なら送信しません）
          <input
            type="email"
            value={notificationEmailValue}
            onChange={(e) => setNotificationEmailValue(e.target.value)}
            placeholder="例：shift@your-company.com"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>
        <div className="mt-2 border-t border-border pt-3">
          <p className="mb-1 text-xs font-semibold text-muted">請求書の振込先（デフォルト）</p>
          <p className="mb-2 text-xs text-muted">
            新しく請求書を作成した時の初期値です。依頼主ごとに異なる場合は、各請求書の編集画面で個別に変更できます（ここを変更しても既存の請求書には影響しません）。
          </p>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              銀行名
              <input
                type="text"
                value={bankNameValue}
                onChange={(e) => setBankNameValue(e.target.value)}
                placeholder="例：〇〇銀行"
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              支店名
              <input
                type="text"
                value={branchNameValue}
                onChange={(e) => setBranchNameValue(e.target.value)}
                placeholder="例：〇〇支店"
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              口座種別
              <input
                type="text"
                value={accountTypeValue}
                onChange={(e) => setAccountTypeValue(e.target.value)}
                placeholder="例：普通"
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              口座番号
              <input
                type="text"
                value={accountNumberValue}
                onChange={(e) => setAccountNumberValue(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              口座名義
              <input
                type="text"
                value={accountHolderNameValue}
                onChange={(e) => setAccountHolderNameValue(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
            </label>
          </div>
        </div>
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
                await updateCompanyNotificationEmailAction(notificationEmailValue);
                await updateCompanyBankInfoAction({
                  bankName: bankNameValue,
                  branchName: branchNameValue,
                  accountType: accountTypeValue,
                  accountNumber: accountNumberValue,
                  accountHolderName: accountHolderNameValue,
                });
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
  const [detailTarget, setDetailTarget] = useState<Admin | null>(null);
  const adminCount = admins.filter((a) => a.role === "COMPANY_ADMIN").length;

  const roleSelect = (a: Admin, isLastAdmin: boolean) => (
    <select
      defaultValue={a.role}
      disabled={pending || isLastAdmin}
      title={isLastAdmin ? "本部管理者は最低1名必要です" : undefined}
      onChange={(e) => {
        setError(null);
        startTransition(async () => {
          try {
            await setCompanyMemberRoleAction(a.userId, e.target.value as "COMPANY_ADMIN" | "COMPANY_EDITOR");
          } catch {
            setError("本部管理者は最低1名必要なため変更できませんでした。");
          }
        });
      }}
      className="rounded-lg border border-border px-2 py-1 text-sm disabled:opacity-60"
    >
      <option value="COMPANY_ADMIN">本部管理者</option>
      <option value="COMPANY_EDITOR">本部編集者</option>
    </select>
  );

  const canWorkCheckbox = (a: Admin) => (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <input
        type="checkbox"
        defaultChecked={a.canWorkShifts}
        disabled={pending}
        onChange={(e) => startTransition(() => setMemberCanWorkShiftsAction(a.userId, e.target.checked))}
      />
      このメンバーはシフトにも入れる
    </label>
  );

  const removeButton = (a: Admin, isLastAdmin: boolean) => (
    <button
      type="button"
      disabled={pending || isLastAdmin}
      title={isLastAdmin ? "本部管理者は最低1名必要です" : undefined}
      onClick={() => {
        setDetailTarget(null);
        setRemoveConfirmTarget({ userId: a.userId, name: a.name });
      }}
      className="text-xs text-muted hover:text-red-600 disabled:opacity-40"
    >
      権限を外す
    </button>
  );

  return (
    <SectionCard title="本部メンバー権限">
      <ul className="mb-4 divide-y divide-border/60 rounded-lg border border-border sm:hidden">
        {admins.map((a) => (
          <li key={a.userId}>
            <button
              type="button"
              onClick={() => setDetailTarget(a)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
            >
              <span className="font-medium">{a.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                {a.role === "COMPANY_ADMIN" ? "本部管理者" : "本部編集者"}
                <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mb-4 hidden overflow-x-auto sm:block">
      <table className="w-full min-w-max text-sm">
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
                <td className="py-2">{roleSelect(a, isLastAdmin)}</td>
                <td className="py-2">{canWorkCheckbox(a)}</td>
                <td className="py-2">{removeButton(a, isLastAdmin)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {detailTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4 sm:hidden"
          onClick={() => setDetailTarget(null)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">{detailTarget.name}</h3>
              <button type="button" onClick={() => setDetailTarget(null)} className="text-muted">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-4 text-sm">
              <p className="text-muted">{detailTarget.email}</p>
              <div>
                <p className="mb-1 text-xs text-muted">権限</p>
                {roleSelect(detailTarget, detailTarget.role === "COMPANY_ADMIN" && adminCount <= 1)}
              </div>
              {canWorkCheckbox(detailTarget)}
              <div className="border-t border-border pt-3">
                {removeButton(detailTarget, detailTarget.role === "COMPANY_ADMIN" && adminCount <= 1)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

function TeamHeaderEditor({
  teamId,
  name,
  notificationEmail,
}: {
  teamId: string;
  name: string;
  notificationEmail: string;
}) {
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(name);
  const [emailValue, setEmailValue] = useState(notificationEmail);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">{name}</span>
          <button
            type="button"
            onClick={() => {
              setNameValue(name);
              setEmailValue(notificationEmail);
              setEditing(true);
            }}
            aria-label="チーム名・通知先を変更"
            className="text-xs text-muted hover:text-primary"
          >
            <span className="inline-block scale-x-[-1]">✎</span>
          </button>
        </div>
        <p className="text-xs text-muted">
          通知先：{notificationEmail || "未設定（チーム宛メール通知は届きません。業務報告の提出・シフト希望の未確定件数をこのチームのマネージャー/リーダーに知らせたい場合に設定してください）"}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-background/40 p-3">
      <label className="flex flex-col gap-1 text-xs">
        チーム名
        <input
          type="text"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          className="rounded-lg border border-border px-2 py-1 text-sm font-semibold"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        通知用メールアドレス（任意）
        <input
          type="email"
          value={emailValue}
          onChange={(e) => setEmailValue(e.target.value)}
          placeholder="例：team-a@your-company.com"
          className="rounded-lg border border-border px-2 py-1 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !nameValue.trim()}
          onClick={() =>
            startTransition(async () => {
              await updateTeamNameAction(teamId, nameValue.trim());
              await updateTeamNotificationEmailAction(teamId, emailValue);
              setEditing(false);
            })
          }
          className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          保存
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted">
          キャンセル
        </button>
      </div>
    </div>
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
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useClickOutside<HTMLSpanElement>(showInfo, () => setShowInfo(false));

  const nextTeamRequiresTee = teams.length > 0;
  const canAffordNextTeam = !nextTeamRequiresTee || teeBalance >= TEAM_UNLOCK_TEE_COST;

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-1.5">
          チーム管理
          <span className="relative" ref={infoRef}>
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              aria-label="説明を見る"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted"
            >
              i
            </button>
            {showInfo ? (
              <div className="absolute left-0 top-full z-10 mt-1.5 w-64 rounded-lg border border-border bg-white p-3 text-xs font-normal normal-case leading-relaxed text-muted shadow-md">
                ここに載るのはチームのマネージャー/リーダーだけです。一般スタッフのチーム所属はスタッフ名簿の各スタッフ詳細から、依頼主/派遣会社との紐付けは各企業詳細から変更できます。1チーム目は無料、2チーム目以降は1チームにつき{TEAM_UNLOCK_TEE_COST}
                {" "}Teeで作成できます（プラン不問）。
              </div>
            ) : null}
          </span>
        </span>
      }
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
      <div className="flex flex-col gap-6">
        {teams.map((team) => {
          const managers = team.members.filter((m) => m.role === "TEAM_MANAGER" || m.role === "TEAM_LEADER");
          return (
          <div key={team.id} className="rounded-xl border border-border p-4">
            <TeamHeaderEditor teamId={team.id} name={team.name} notificationEmail={team.notificationEmail} />

            {managers.length > 0 ? (
              <>
              <div className="mb-2 hidden overflow-x-auto sm:block">
              <table className="w-full min-w-max text-sm">
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
              </div>

              <div className="mb-2 flex flex-col gap-2 sm:hidden">
                {managers.map((m) => (
                  <div key={m.userId} className="rounded-lg border border-border/60 p-2.5 text-sm">
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-muted">{m.email}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
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
                        onClick={() => setRemoveConfirmTarget({ teamId: team.id, userId: m.userId, name: m.name })}
                        className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
                      >
                        権限を外す
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              </>
            ) : (
              <p className="mb-2 text-xs text-muted">まだマネージャー/リーダーがいません。</p>
            )}

            <div className="mt-3 border-t border-border pt-3">
              {inviteFormTeamId === team.id ? (
                <TeamInviteForm
                  teamId={team.id}
                  // 既に一般メンバーとしてこのチームに所属している人も、ここから
                  // マネージャー/リーダーへ直接昇格できるように含める（既に
                  // マネージャー/リーダーの人だけ除外する）。以前は所属済みなら
                  // 誰でも一律除外していたため、一般メンバーを直接昇格させる
                  // 方法がUI上に存在しなかった。
                  staffOptions={staff.filter((s) => {
                    const existingRole = team.members.find((m) => m.userId === s.userId)?.role;
                    return existingRole !== "TEAM_MANAGER" && existingRole !== "TEAM_LEADER";
                  })}
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
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-muted">スタッフ</span>
              <select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="rounded-lg border border-border px-2 py-1.5 text-sm text-foreground"
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

        {mode === "existing" ? (
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-muted">権限</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "TEAM_MANAGER" | "TEAM_LEADER")}
              className="rounded-lg border border-border px-2 py-1.5 text-sm text-foreground"
            >
              <option value="TEAM_MANAGER">マネージャー</option>
              <option value="TEAM_LEADER">リーダー</option>
            </select>
          </label>
        ) : null}

        {mode === "new" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                // 招待の時点では権限を選ばせず、まずリーダーとして招待する。
                // マネージャーへの昇格は参加後、上の一覧の「権限」セレクトから
                // 行う（招待URL発行のたびに権限を選ばせるのは煩雑なだけで、
                // 参加前に決め打ちする必要が無いため）。
                const url = await inviteTeamManagerAction(teamId, "TEAM_LEADER");
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

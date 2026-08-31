"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getStaffMonthDetailAction,
  updateStaffNoteAction,
  inviteProxyUpgradeAction,
  updateStaffIdDocumentAction,
  updateStaffBankInfoAction,
} from "@/app/company/actions";
import {
  addStaffTaskRateVersionAction,
  deleteStaffTaskRateAction,
  updateStaffContractWageAction,
  endStaffContractAction,
} from "@/app/company/contracts/actions";
import { todayJstParts, todayJst } from "@/lib/date";
import { CopyUrlField } from "@/components/CopyUrlField";
import { ImageDropzone } from "@/components/ImageDropzone";
import { TemplateModal, ChooseBaseTemplateModal, AssignOrCustomizeModal, type Template } from "@/components/company/ContractsView";

type StaffTaskRate = {
  id: string;
  taskName: string;
  companyRelationshipId: string | null;
  workplaceLabel: string;
  currentLabel: string;
  versions: { id: string; label: string; effectiveFrom: string }[];
};

type ClientOption = { id: string; name: string };

type StaffMonthDetail = {
  membershipId: string;
  name: string;
  isProxy: boolean;
  note: string;
  teams: { teamId: string; teamName: string }[];
  monthlyHours: number;
  daysWorked: number;
  idDocumentFrontUrl: string | null;
  idDocumentBackUrl: string | null;
  bankInfo: {
    bankName: string;
    branchName: string;
    accountType: string;
    accountNumber: string;
    accountHolderName: string;
  };
  contracts: {
    id: string;
    title: string;
    status: string;
    wageType: "HOURLY" | "DAILY" | "MONTHLY";
    wageAmount: number;
    wageLabel: string;
    employmentTypeLabel: string;
    jobDescription: string;
    workplaceName: string;
    contractStartDate: string;
    contractEndDate: string | null;
    noticeGivenAt: string | null;
    wageVersions: { id: string; label: string; effectiveFrom: string }[];
    templateDetail: Template;
  }[];
  taskRates: StaffTaskRate[];
  days: {
    shiftId: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    isAllDay: boolean;
    isUndecided: boolean;
    approvalStatus: string | null;
    outcome: string | null;
    actualStartTime: string | null;
    actualEndTime: string | null;
    comment: string | null;
    taskName: string | null;
    workplaceLabel: string;
  }[];
};

const APPROVAL_PILL: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-sky-100 text-sky-800",
  REJECTED: "bg-rose-100 text-rose-800",
};
const APPROVAL_LABEL: Record<string, string> = {
  PENDING: "未承認",
  APPROVED: "承認済み",
  REJECTED: "差戻し",
};
const CONTRACT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "確認済み",
  PENDING_CONSENT: "確認待ち",
  ENDED: "終了",
};

function actualTimeLabel(d: StaffMonthDetail["days"][number]) {
  if (!d.actualStartTime && !d.actualEndTime) return "—";
  return `${d.actualStartTime ?? "--:--"}〜${d.actualEndTime ?? "--:--"}`;
}

export function StaffDetailPanel({
  userId,
  companyName,
  clients,
  contractTemplates,
  knownTaskNames,
  initialTab,
  onClose,
}: {
  userId: string;
  companyName: string;
  clients: ClientOption[];
  contractTemplates: Template[];
  knownTaskNames: string[];
  initialTab?: "contracts";
  onClose: () => void;
}) {
  const router = useRouter();
  const initToday = todayJstParts();
  const [year, setYear] = useState(initToday.year);
  const [month, setMonth] = useState(initToday.month);
  const [tab, setTab] = useState<"history" | "contracts" | "rates" | "note">(initialTab ?? "history");
  const [data, setData] = useState<StaffMonthDetail | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [editWageAmount, setEditWageAmount] = useState("");
  const [editWageEffectiveFrom, setEditWageEffectiveFrom] = useState(todayJst());
  const [editWageError, setEditWageError] = useState<string | null>(null);
  const [detailContractId, setDetailContractId] = useState<string | null>(null);
  const [editingIdDocument, setEditingIdDocument] = useState(false);
  const [showGenerateChoose, setShowGenerateChoose] = useState(false);
  const [generateBaseTemplate, setGenerateBaseTemplate] = useState<Template | null>(null);
  const [generateCustomize, setGenerateCustomize] = useState(false);
  const [showContractHistory, setShowContractHistory] = useState(false);

  function endGenerateFlow() {
    setShowGenerateChoose(false);
    setGenerateBaseTemplate(null);
    setGenerateCustomize(false);
    refresh();
  }

  const [endingContract, setEndingContract] = useState<{ id: string; title: string } | null>(null);
  const [endNoticeDate, setEndNoticeDate] = useState(todayJst());

  function submitEndContract() {
    if (!endingContract) return;
    const staffContractId = endingContract.id;
    startTransition(async () => {
      await endStaffContractAction(staffContractId, endNoticeDate || null);
      setEndingContract(null);
      await refresh();
    });
  }
  const [editingBankInfo, setEditingBankInfo] = useState(false);
  const [bankName, setBankName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [accountType, setAccountType] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");

  function startEditBankInfo(info: StaffMonthDetail["bankInfo"]) {
    setBankName(info.bankName);
    setBranchName(info.branchName);
    setAccountType(info.accountType);
    setAccountNumber(info.accountNumber);
    setAccountHolderName(info.accountHolderName);
    setEditingBankInfo(true);
  }

  function submitBankInfo(membershipId: string) {
    startTransition(async () => {
      await updateStaffBankInfoAction(membershipId, {
        bankName,
        branchName,
        accountType,
        accountNumber,
        accountHolderName,
      });
      setEditingBankInfo(false);
      await refresh();
    });
  }

  function uploadIdDocument(membershipId: string, side: "front" | "back", url: string) {
    startTransition(async () => {
      await updateStaffIdDocumentAction(membershipId, side, url);
      await refresh();
    });
  }

  function startEditWage(c: StaffMonthDetail["contracts"][number]) {
    setEditingContractId(c.id);
    setEditWageAmount(String(c.wageAmount));
    setEditWageEffectiveFrom(todayJst());
    setEditWageError(null);
  }

  function submitEditWage(c: StaffMonthDetail["contracts"][number]) {
    if (!editWageAmount) return;
    setEditWageError(null);
    startTransition(async () => {
      const result = await updateStaffContractWageAction(c.id, Number(editWageAmount), editWageEffectiveFrom);
      if (result?.error) {
        setEditWageError(
          result.error === "monthly_wage_requires_month_start"
            ? "月給は月初（1日）からのみ改定できます。"
            : "保存に失敗しました。",
        );
        return;
      }
      setEditingContractId(null);
      await refresh();
    });
  }

  function handleUpgrade() {
    startTransition(async () => {
      const url = await inviteProxyUpgradeAction(userId);
      setUpgradeUrl(url);
    });
  }

  function refresh() {
    return getStaffMonthDetailAction(userId, year, month).then((d) => {
      setData(d);
      setNoteValue(d.note);
    });
  }

  useEffect(() => {
    let cancelled = false;
    getStaffMonthDetailAction(userId, year, month).then((d) => {
      if (cancelled) return;
      setData(d);
      setNoteValue(d.note);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, year, month]);

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="mb-2 self-start text-sm text-muted">
          ← 閉じる
        </button>

        {!data ? (
          <p className="text-sm text-muted">読み込み中…</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif-jp text-xl font-bold">{data.name}</h2>
            </div>

            {data.isProxy ? (
              <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs">
                {upgradeUrl ? (
                  <CopyUrlField url={upgradeUrl} size="sm" />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span>仮アカウントです。本人に招待URLを送って本アカウントと連携できます。</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={handleUpgrade}
                      className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      本アカウントと連携する
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="mb-4 flex flex-wrap gap-1">
              {data.teams.length === 0 ? (
                <span className="text-xs text-muted">チーム未所属</span>
              ) : (
                data.teams.map((t) => (
                  <span key={t.teamId} className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900">
                    {t.teamName}
                  </span>
                ))
              )}
            </div>

            <div className="mb-4 flex gap-4 border-b border-border text-sm">
              <button
                type="button"
                onClick={() => setTab("history")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "history" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                稼働履歴
              </button>
              <button
                type="button"
                onClick={() => setTab("contracts")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "contracts" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                契約書管理
              </button>
              <button
                type="button"
                onClick={() => setTab("rates")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "rates" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                業務内容単価
              </button>
              <button
                type="button"
                onClick={() => setTab("note")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "note" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                情報メモ
              </button>
            </div>

            {tab === "history" ? (
              <div>
                <div className="mb-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    aria-label="前の月"
                    className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                      <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <span className="font-serif-jp text-lg font-bold">
                    {year}年{month}月
                  </span>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    aria-label="次の月"
                    className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                      <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted">稼働時間</p>
                    <p className="text-lg font-bold">{data.monthlyHours}h</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted">出勤日数</p>
                    <p className="text-lg font-bold">{data.daysWorked}日</p>
                  </div>
                  <div className="flex flex-col items-center justify-center rounded-lg border border-border p-3">
                    <p className="mb-1 text-xs text-muted">給料明細</p>
                    <button
                      type="button"
                      onClick={() => router.push(`/company/payroll?month=${year}-${String(month).padStart(2, "0")}&staff=${userId}`)}
                      className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                    >
                      計算する
                    </button>
                  </div>
                </div>

                <ul className="flex flex-col gap-1">
                  {data.days.map((d) => (
                    <li
                      key={d.shiftId}
                      className="grid grid-cols-[62px_1fr_82px_68px] items-center gap-2 border-b border-border/50 py-2 text-xs"
                    >
                      <span>{d.date.slice(5)}</span>
                      <span className="truncate text-muted" title={`${d.workplaceLabel}${d.taskName ? `（${d.taskName}）` : ""}`}>
                        {d.workplaceLabel}
                        {d.taskName ? `（${d.taskName}）` : ""}
                      </span>
                      <span className="text-muted">{actualTimeLabel(d)}</span>
                      {d.approvalStatus ? (
                        <span
                          className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-center font-semibold ${APPROVAL_PILL[d.approvalStatus]}`}
                        >
                          {APPROVAL_LABEL[d.approvalStatus]}
                        </span>
                      ) : (
                        <span className="whitespace-nowrap rounded-md bg-gray-100 px-1.5 py-0.5 text-center font-semibold text-gray-600">
                          未提出
                        </span>
                      )}
                      {d.comment ? (
                        <p className="col-span-4 -mt-0.5 break-words text-[11px] text-muted">💬 {d.comment}</p>
                      ) : null}
                    </li>
                  ))}
                  {data.days.length === 0 ? <p className="py-6 text-center text-sm text-muted">この月のシフトはありません。</p> : null}
                </ul>
              </div>
            ) : null}

            {tab === "contracts" ? (
              <div className="flex flex-col gap-4">
                {(() => {
                  const currentContracts = data.contracts.filter((c) => c.status !== "ENDED");
                  const pastContracts = data.contracts.filter((c) => c.status === "ENDED");
                  return (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted">現在の契約</p>
                        <button
                          type="button"
                          onClick={() => setShowGenerateChoose(true)}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                        >
                          ＋契約書を生成
                        </button>
                      </div>
                      <ul className="flex flex-col gap-2">
                        {currentContracts.map((c) => (
                          <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                            <p className="font-semibold">{c.title}</p>
                            <p className="text-muted">
                              {c.workplaceName} ／ {c.wageLabel}
                            </p>
                            <p className="text-xs text-muted">
                              契約期間: {c.contractStartDate} 〜 {c.contractEndDate ?? "期間の定めなし"}
                            </p>
                            <div className="mt-1 flex items-center justify-between">
                              <p className="text-xs text-muted">{CONTRACT_STATUS_LABEL[c.status] ?? c.status}</p>
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => setDetailContractId(c.id)}
                                  className="text-xs text-primary hover:underline"
                                >
                                  詳細確認
                                </button>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => {
                                    setEndNoticeDate(todayJst());
                                    setEndingContract({ id: c.id, title: c.title });
                                  }}
                                  className="text-xs text-muted hover:text-red-600 disabled:opacity-60"
                                >
                                  終了する
                                </button>
                              </div>
                            </div>
                          </li>
                        ))}
                        {currentContracts.length === 0 ? (
                          <p className="py-6 text-center text-sm text-muted">契約書はありません。</p>
                        ) : null}
                      </ul>

                      {pastContracts.length > 0 ? (
                        <div>
                          <button
                            type="button"
                            onClick={() => setShowContractHistory((v) => !v)}
                            className="text-xs text-muted hover:text-primary"
                          >
                            {showContractHistory ? "▲ 過去の契約を閉じる" : `▼ 過去の契約（${pastContracts.length}件）`}
                          </button>
                          {showContractHistory ? (
                            <ul className="mt-2 flex flex-col gap-2">
                              {pastContracts.map((c) => (
                                <li key={c.id} className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                                  <p className="font-semibold">{c.title}</p>
                                  <p className="text-muted">
                                    {c.workplaceName} ／ {c.wageLabel}
                                  </p>
                                  <p className="text-xs text-muted">
                                    契約期間: {c.contractStartDate} 〜 {c.contractEndDate ?? "期間の定めなし"}
                                  </p>
                                  {c.noticeGivenAt ? (
                                    <p className="text-xs text-muted">予告日: {c.noticeGivenAt}</p>
                                  ) : null}
                                  <div className="mt-1 flex items-center justify-between">
                                    <p className="text-xs text-muted">{CONTRACT_STATUS_LABEL[c.status] ?? c.status}</p>
                                    <button
                                      type="button"
                                      onClick={() => setDetailContractId(c.id)}
                                      className="text-xs text-primary hover:underline"
                                    >
                                      詳細確認
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                <div className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">本人確認書類</p>
                    <button
                      type="button"
                      onClick={() => setEditingIdDocument(true)}
                      className="text-xs text-primary hover:underline"
                    >
                      アップロード
                    </button>
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {(["front", "back"] as const).map((side) => {
                      const url = side === "front" ? data.idDocumentFrontUrl : data.idDocumentBackUrl;
                      return (
                        <div key={side} className="flex items-center justify-between text-xs">
                          <span className="text-muted">{side === "front" ? "表面" : "裏面"}</span>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                              📎 画像を見る
                            </a>
                          ) : (
                            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600">未提出</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">振込先情報</p>
                    <button
                      type="button"
                      onClick={() => startEditBankInfo(data.bankInfo)}
                      className="text-xs text-primary hover:underline"
                    >
                      {data.bankInfo.bankName ? "編集" : "登録"}
                    </button>
                  </div>
                  {data.bankInfo.bankName ? (
                    <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
                      <span>
                        {data.bankInfo.bankName} {data.bankInfo.branchName}（{data.bankInfo.accountType}）
                      </span>
                      <span>口座番号: {data.bankInfo.accountNumber}</span>
                      <span>口座名義: {data.bankInfo.accountHolderName}</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted">未設定</p>
                  )}
                </div>
              </div>
            ) : null}

            {tab === "rates" ? (
              <StaffTaskRatesTab
                userId={userId}
                rates={data.taskRates}
                clients={clients}
                knownTaskNames={knownTaskNames}
                onChanged={refresh}
                baseContract={data.contracts.find((c) => c.status === "ACTIVE") ?? null}
                onEditBaseWage={startEditWage}
              />
            ) : null}

            {tab === "note" ? (
              <div className="flex flex-col gap-3">
                <textarea
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  rows={8}
                  placeholder="このスタッフに関するメモを入力"
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => updateStaffNoteAction(data.membershipId, noteValue))}
                  className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  保存
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {editingContractId && data ? (
        (() => {
          const editingContract = data.contracts.find((c) => c.id === editingContractId);
          if (!editingContract) return null;
          return (
            <div
              className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
              onClick={() => setEditingContractId(null)}
            >
              <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-serif-jp text-base font-bold text-primary">基本給を改定（{editingContract.title}）</h4>
                  <button
                    type="button"
                    onClick={() => setEditingContractId(null)}
                    aria-label="閉じる"
                    className="text-muted hover:text-primary"
                  >
                    ✕
                  </button>
                </div>
                <p className="mb-2 text-xs text-muted">
                  同意の結び直しは不要です。保存すると即座に反映され、スタッフにはお知らせが届きます。
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{WAGE_TYPE_OPTIONS.find((o) => o.value === editingContract.wageType)?.label}</span>
                    <input
                      type="number"
                      value={editWageAmount}
                      onChange={(e) => setEditWageAmount(e.target.value)}
                      placeholder="金額"
                      className="w-28 rounded-lg border border-border px-2 py-2 text-sm"
                    />
                    <span className="text-sm text-muted">円</span>
                  </div>
                  <label className="flex flex-col gap-0.5 text-xs text-muted">
                    開始日
                    <input
                      type="date"
                      value={editWageEffectiveFrom}
                      onChange={(e) => setEditWageEffectiveFrom(e.target.value)}
                      className="rounded-lg border border-border px-2 py-2 text-sm"
                    />
                  </label>
                </div>
                {editingContract.wageType === "MONTHLY" ? (
                  <p className="mt-1 text-xs text-muted">月給は月初（1日）からのみ改定できます。</p>
                ) : null}
                {editWageError ? <p className="mt-1 text-xs text-red-600">{editWageError}</p> : null}
                <button
                  type="button"
                  disabled={pending || !editWageAmount}
                  onClick={() => submitEditWage(editingContract)}
                  className="mt-3 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  保存
                </button>
              </div>
            </div>
          );
        })()
      ) : null}

      {detailContractId && data
        ? (() => {
            const detailContract = data.contracts.find((c) => c.id === detailContractId);
            if (!detailContract) return null;
            return (
              <TemplateModal
                readOnly
                companyName={companyName}
                clients={clients}
                editingTemplate={detailContract.templateDetail}
                onClose={() => setDetailContractId(null)}
              />
            );
          })()
        : null}

      {endingContract ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setEndingContract(null)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">契約を終了する</h4>
              <button
                type="button"
                onClick={() => setEndingContract(null)}
                aria-label="閉じる"
                className="text-muted hover:text-primary"
              >
                ✕
              </button>
            </div>
            <p className="text-sm">「{endingContract.title}」を終了します。</p>
            <p className="mt-1 text-xs text-muted">
              解雇・雇止め・業務委託契約の中途解除などは、契約の種類によって法律上30日前の予告が必要になる場合があります（本アプリは法律要件の判定は行いません。要件については社労士・弁護士等にご確認ください）。
            </p>
            <label className="mt-3 flex flex-col gap-0.5 text-xs text-muted">
              本人へ通知した日
              <input
                type="date"
                value={endNoticeDate}
                onChange={(e) => setEndNoticeDate(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEndingContract(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submitEndContract}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                終了する
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showGenerateChoose && !generateBaseTemplate && data ? (
        <ChooseBaseTemplateModal
          staffName={data.name}
          templates={contractTemplates}
          onNext={(t) => setGenerateBaseTemplate(t)}
          onClose={() => setShowGenerateChoose(false)}
        />
      ) : null}
      {showGenerateChoose && generateBaseTemplate && !generateCustomize && data ? (
        <AssignOrCustomizeModal
          staffName={data.name}
          staffUserId={userId}
          template={generateBaseTemplate}
          onAssigned={endGenerateFlow}
          onCustomize={() => setGenerateCustomize(true)}
          onClose={endGenerateFlow}
        />
      ) : null}
      {showGenerateChoose && generateBaseTemplate && generateCustomize && data ? (
        <TemplateModal
          companyName={companyName}
          clients={clients}
          editingTemplate={generateBaseTemplate}
          generateForStaff={{ userId, name: data.name }}
          onClose={endGenerateFlow}
        />
      ) : null}

      {editingIdDocument && data ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setEditingIdDocument(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">本人確認書類をアップロード</h4>
              <button
                type="button"
                onClick={() => setEditingIdDocument(false)}
                aria-label="閉じる"
                className="text-muted hover:text-primary"
              >
                ✕
              </button>
            </div>
            <div className="flex justify-center gap-6">
              <div className="w-32">
                <ImageDropzone
                  label="表面"
                  imageUrl={data.idDocumentFrontUrl ?? ""}
                  onChange={(url) => uploadIdDocument(data.membershipId, "front", url)}
                />
              </div>
              <div className="w-32">
                <ImageDropzone
                  label="裏面"
                  imageUrl={data.idDocumentBackUrl ?? ""}
                  onChange={(url) => uploadIdDocument(data.membershipId, "back", url)}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editingBankInfo && data ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setEditingBankInfo(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">振込先情報を編集</h4>
              <button type="button" onClick={() => setEditingBankInfo(false)} aria-label="閉じる" className="text-muted hover:text-primary">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                銀行名
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                支店名
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                口座種別
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
                >
                  <option value="">未選択</option>
                  <option value="普通">普通</option>
                  <option value="当座">当座</option>
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                口座番号
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                口座名義
                <input
                  type="text"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => submitBankInfo(data.membershipId)}
              className="mt-3 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              保存
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const WAGE_TYPE_OPTIONS: { value: "HOURLY" | "DAILY" | "MONTHLY"; label: string }[] = [
  { value: "HOURLY", label: "時給" },
  { value: "DAILY", label: "日給" },
  { value: "MONTHLY", label: "月給" },
];

const NEW_TASK_NAME_SENTINEL = "__new__";

// 単価は上書きしない — 編集は新しいバージョンを開始日付きで積む。削除は
// 承認済みの実績シフトで一度も参照されていないものだけ可能（間違い登録の
// 取消し用）。既に使われた単価は削除できず、そのまま残しておく。
function StaffTaskRatesTab({
  userId,
  rates,
  clients,
  knownTaskNames,
  onChanged,
  baseContract,
  onEditBaseWage,
}: {
  userId: string;
  rates: StaffTaskRate[];
  clients: ClientOption[];
  knownTaskNames: string[];
  onChanged: () => Promise<void>;
  baseContract: StaffMonthDetail["contracts"][number] | null;
  onEditBaseWage: (c: StaffMonthDetail["contracts"][number]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [baseHistoryOpen, setBaseHistoryOpen] = useState(false);
  const [amendingId, setAmendingId] = useState<string | null>(null);
  const [amendWageType, setAmendWageType] = useState<"HOURLY" | "DAILY" | "MONTHLY">("HOURLY");
  const [amendAmount, setAmendAmount] = useState("");
  const [amendEffectiveFrom, setAmendEffectiveFrom] = useState(todayJst());
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTaskNameMode, setNewTaskNameMode] = useState<"pick" | "custom">("custom");
  const [newTaskName, setNewTaskName] = useState("");
  const [newCompanyRelationshipId, setNewCompanyRelationshipId] = useState("");
  const [newWageType, setNewWageType] = useState<"HOURLY" | "DAILY" | "MONTHLY">("HOURLY");
  const [newAmount, setNewAmount] = useState("");
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(todayJst());

  function openNewForm() {
    setShowNewForm(true);
    setNewTaskName("");
    setNewTaskNameMode(knownTaskNames.length > 0 ? "pick" : "custom");
  }

  const amendingRate = rates.find((r) => r.id === amendingId) ?? null;

  function startAmend(r: StaffTaskRate) {
    setAmendingId(r.id);
    setAmendWageType("HOURLY");
    setAmendAmount("");
    setAmendEffectiveFrom(todayJst());
  }

  function submitAmend(r: StaffTaskRate) {
    if (!amendAmount) return;
    startTransition(async () => {
      await addStaffTaskRateVersionAction({
        staffUserId: userId,
        taskName: r.taskName,
        companyRelationshipId: r.companyRelationshipId ?? undefined,
        wageType: amendWageType,
        amount: Number(amendAmount),
        effectiveFrom: amendEffectiveFrom,
      });
      setAmendingId(null);
      await onChanged();
    });
  }

  function submitDelete(r: StaffTaskRate) {
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteStaffTaskRateAction(r.id);
        await onChanged();
      } catch {
        setDeleteError({ id: r.id, message: "この業務内容は給料計算の実績で使用されているため削除できません。" });
      }
    });
  }

  function submitNewTask() {
    if (!newTaskName.trim() || !newAmount) return;
    startTransition(async () => {
      await addStaffTaskRateVersionAction({
        staffUserId: userId,
        taskName: newTaskName.trim(),
        companyRelationshipId: newCompanyRelationshipId || undefined,
        wageType: newWageType,
        amount: Number(newAmount),
        effectiveFrom: newEffectiveFrom,
      });
      setShowNewForm(false);
      setNewTaskName("");
      setNewCompanyRelationshipId("");
      setNewAmount("");
      setNewEffectiveFrom(todayJst());
      await onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">未登録の業務内容は、雇用契約の基本単価で給与計算されます。</p>
        <button
          type="button"
          onClick={openNewForm}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          ＋業務内容を追加
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {baseContract ? (
          <li className="rounded-lg border border-border bg-background/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                基本給・{baseContract.employmentTypeLabel}{" "}
                <span className="text-xs font-normal text-muted">（{baseContract.jobDescription}）</span>
              </span>
              <span className="text-muted">{baseContract.wageLabel}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setBaseHistoryOpen((v) => !v)}
                className="text-muted hover:text-primary"
              >
                {baseHistoryOpen ? "▲ 履歴を閉じる" : `▼ 履歴（${baseContract.wageVersions.length}件）`}
              </button>
              <button type="button" onClick={() => onEditBaseWage(baseContract)} className="text-primary hover:underline">
                改定
              </button>
            </div>
            {baseHistoryOpen ? (
              <ul className="mt-2 flex flex-col text-xs text-muted">
                {baseContract.wageVersions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between border-t border-border/50 py-1">
                    <span>{v.effectiveFrom} 〜</span>
                    <span>{v.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
        {rates.map((r) => (
          <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {r.workplaceLabel} <span className="text-xs font-normal text-muted">（{r.taskName}）</span>
              </span>
              <span className="text-muted">{r.currentLabel}</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                className="text-muted hover:text-primary"
              >
                {expandedId === r.id ? "▲ 履歴を閉じる" : `▼ 履歴（${r.versions.length}件）`}
              </button>
              <button type="button" onClick={() => startAmend(r)} className="text-primary hover:underline">
                単価を変更
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => submitDelete(r)}
                className="text-muted hover:text-red-600 disabled:opacity-60"
              >
                削除
              </button>
            </div>

            {deleteError?.id === r.id ? <p className="mt-1 text-xs text-red-600">{deleteError.message}</p> : null}

            {expandedId === r.id ? (
              <ul className="mt-2 flex flex-col text-xs text-muted">
                {r.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between border-t border-border/50 py-1">
                    <span>{v.effectiveFrom} 〜</span>
                    <span>{v.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
        {rates.length === 0 ? <p className="py-6 text-center text-sm text-muted">個別の単価は登録されていません。</p> : null}
      </ul>

      {amendingRate ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setAmendingId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">
                単価を変更（{amendingRate.taskName} ／ {amendingRate.workplaceLabel}）
              </h4>
              <button type="button" onClick={() => setAmendingId(null)} aria-label="閉じる" className="text-muted hover:text-primary">
                ✕
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <select
                value={amendWageType}
                onChange={(e) => setAmendWageType(e.target.value as "HOURLY" | "DAILY" | "MONTHLY")}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              >
                {WAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={amendAmount}
                onChange={(e) => setAmendAmount(e.target.value)}
                placeholder="金額"
                className="w-24 rounded-lg border border-border px-2 py-2 text-sm"
              />
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                開始日
                <input
                  type="date"
                  value={amendEffectiveFrom}
                  onChange={(e) => setAmendEffectiveFrom(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pending || !amendAmount}
              onClick={() => submitAmend(amendingRate)}
              className="mt-3 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              保存
            </button>
          </div>
        </div>
      ) : null}

      {showNewForm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowNewForm(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">業務内容を追加</h4>
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                aria-label="閉じる"
                className="text-muted hover:text-primary"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {newTaskNameMode === "pick" ? (
                <select
                  value={newTaskName}
                  onChange={(e) => {
                    if (e.target.value === NEW_TASK_NAME_SENTINEL) {
                      setNewTaskNameMode("custom");
                      setNewTaskName("");
                    } else {
                      setNewTaskName(e.target.value);
                    }
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="">業務内容を選択</option>
                  {knownTaskNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value={NEW_TASK_NAME_SENTINEL}>＋ 新しい業務内容を追加する</option>
                </select>
              ) : (
                <div className="flex flex-col gap-1">
                  <input
                    type="text"
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    placeholder="業務内容（例：キャディ業務）"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                  {knownTaskNames.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNewTaskNameMode("pick");
                        setNewTaskName("");
                      }}
                      className="self-start text-xs text-muted hover:text-primary"
                    >
                      ← 既存の業務内容から選ぶ
                    </button>
                  ) : null}
                </div>
              )}
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                勤務先
                <select
                  value={newCompanyRelationshipId}
                  onChange={(e) => setNewCompanyRelationshipId(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                >
                  <option value="">勤務先を問わない</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <select
                  value={newWageType}
                  onChange={(e) => setNewWageType(e.target.value as "HOURLY" | "DAILY" | "MONTHLY")}
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                >
                  {WAGE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  placeholder="金額"
                  className="w-24 rounded-lg border border-border px-2 py-2 text-sm"
                />
                <label className="flex flex-col gap-0.5 text-xs text-muted">
                  開始日
                  <input
                    type="date"
                    value={newEffectiveFrom}
                    onChange={(e) => setNewEffectiveFrom(e.target.value)}
                    className="rounded-lg border border-border px-2 py-2 text-sm"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={pending || !newTaskName.trim() || !newAmount}
                onClick={submitNewTask}
                className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

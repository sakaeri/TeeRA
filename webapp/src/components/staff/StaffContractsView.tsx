"use client";

import { useState, useTransition } from "react";
import { consentContractAction } from "@/app/staff/contracts/actions";
import { updateMyIdDocumentAction, updateMyBankInfoAction } from "@/app/staff/actions";
import { ImageDropzone } from "@/components/ImageDropzone";
import { TemplateModal, type Template } from "@/components/company/ContractsView";

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };
const STATUS_LABEL: Record<string, string> = {
  PENDING_CONSENT: "承諾待ち",
  ACTIVE: "契約中",
  ENDED: "終了",
};

type BankInfo = {
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolderName: string;
};

type PendingContract = { id: string; templateDetail: Template };

type TaskRate = {
  id: string;
  taskName: string;
  workplaceLabel: string;
  currentLabel: string;
  versions: { id: string; label: string; effectiveFrom: string }[];
};

type BaseWage = {
  employmentTypeLabel: string;
  jobDescription: string;
  currentLabel: string;
  versions: { id: string; label: string; effectiveFrom: string }[];
};

type WizardStep = "review" | "id" | "bank" | "done";

export function StaffContractsView({
  companyId,
  companyName,
  myContracts,
  pendingContracts,
  idDocumentFrontUrl,
  idDocumentBackUrl,
  bankInfo,
  baseWage,
  taskRates,
  clientNames,
}: {
  companyId: string;
  companyName: string;
  myContracts: {
    id: string;
    title: string;
    status: string;
    wageAmountSnapshot: number;
    wageType: string;
    contractStartDate: string;
  }[];
  pendingContracts: PendingContract[];
  idDocumentFrontUrl: string | null;
  idDocumentBackUrl: string | null;
  bankInfo: BankInfo;
  baseWage: BaseWage | null;
  taskRates: TaskRate[];
  clientNames: string[];
}) {
  const [pending, startTransition] = useTransition();

  const [frontUrl, setFrontUrl] = useState(idDocumentFrontUrl ?? "");
  const [backUrl, setBackUrl] = useState(idDocumentBackUrl ?? "");
  const [bankName, setBankName] = useState(bankInfo.bankName);
  const [branchName, setBranchName] = useState(bankInfo.branchName);
  const [accountType, setAccountType] = useState(bankInfo.accountType);
  const [accountNumber, setAccountNumber] = useState(bankInfo.accountNumber);
  const [accountHolderName, setAccountHolderName] = useState(bankInfo.accountHolderName);
  const [saved, setSaved] = useState(false);
  const [idEditing, setIdEditing] = useState(false);
  const [bankEditing, setBankEditing] = useState(false);
  const [showPastContracts, setShowPastContracts] = useState(false);
  const [expandedRateId, setExpandedRateId] = useState<string | null>(null);

  // 同意アクションはrevalidatePathでこのページのサーバーデータを更新する
  // ため、pendingContractsのpropsはウィザードの途中でも変わりうる。ウィザ
  // ードの進行状態がその変化に巻き込まれて消えてしまわないよう、対象一覧は
  // マウント時に一度だけ固定し、以後はローカルのインデックスだけで進める。
  const [queue] = useState(() => pendingContracts);
  const [queueIndex, setQueueIndex] = useState(0);
  const activePending = queue[queueIndex] ?? null;
  const [wizardStep, setWizardStep] = useState<WizardStep>("review");
  const [showDetail, setShowDetail] = useState(false);

  const currentContracts = myContracts.filter((c) => c.status !== "ENDED");
  const pastContracts = myContracts.filter((c) => c.status === "ENDED");

  function idComplete() {
    return frontUrl !== "" && backUrl !== "";
  }
  function bankComplete() {
    return bankName.trim() !== "" && accountNumber.trim() !== "";
  }
  function nextStepAfter(current: "review" | "id" | "bank"): WizardStep {
    if (current === "review" && !idComplete()) return "id";
    if (current !== "bank" && !bankComplete()) return "bank";
    return "done";
  }

  function submitConsent() {
    if (!activePending) return;
    const id = activePending.id;
    startTransition(async () => {
      await consentContractAction(id, companyId);
      setWizardStep(nextStepAfter("review"));
    });
  }

  function uploadIdDocument(side: "front" | "back", url: string) {
    if (side === "front") setFrontUrl(url);
    else setBackUrl(url);
    startTransition(() => updateMyIdDocumentAction(companyId, side, url));
  }

  function submitBankInfo(advance: boolean) {
    setSaved(false);
    startTransition(async () => {
      await updateMyBankInfoAction(companyId, { bankName, branchName, accountType, accountNumber, accountHolderName });
      if (advance) {
        setWizardStep("done");
      } else {
        setSaved(true);
        setBankEditing(false);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  function finishWizard() {
    setQueueIndex((i) => i + 1);
    setWizardStep("review");
  }

  return (
    <div className="flex flex-col gap-8">
      {activePending ? (
        <section className="rounded-2xl border-2 border-primary bg-white p-6">
          <p className="mb-1 text-xs font-semibold text-primary">新しい契約書があります</p>
          <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">
            {wizardStep === "review"
              ? "① 契約内容を確認"
              : wizardStep === "id"
                ? "② 本人確認書類を提出"
                : wizardStep === "bank"
                  ? "③ 振込先情報を入力"
                  : "④ 完了"}
          </h2>

          {wizardStep === "review" ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <p className="font-semibold">{activePending.templateDetail.title}</p>
                <p className="text-muted">
                  {WAGE_TYPE_LABEL[activePending.templateDetail.wageType]} {activePending.templateDetail.wageAmount}円
                </p>
                <p className="text-xs text-muted">契約開始日: {activePending.templateDetail.contractStartDate}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDetail(true)}
                className="self-start text-xs text-primary hover:underline"
              >
                契約書の全文を確認する
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submitConsent}
                className="mt-2 self-start rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                内容を確認しました（同意する）
              </button>
            </div>
          ) : null}

          {wizardStep === "id" ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted">運転免許証など、両面の写真を提出してください。</p>
              <div className="flex gap-6">
                <div className="w-40">
                  <ImageDropzone label="表面" required imageUrl={frontUrl} onChange={(url) => uploadIdDocument("front", url)} />
                </div>
                <div className="w-40">
                  <ImageDropzone label="裏面" required imageUrl={backUrl} onChange={(url) => uploadIdDocument("back", url)} />
                </div>
              </div>
              <button
                type="button"
                disabled={!idComplete()}
                onClick={() => setWizardStep(nextStepAfter("id"))}
                className="mt-2 self-start rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                次へ
              </button>
            </div>
          ) : null}

          {wizardStep === "bank" ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted">
                銀行名
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                支店名
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                口座種別
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="">未選択</option>
                  <option value="普通">普通</option>
                  <option value="当座">当座</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                口座番号
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                口座名義
                <input
                  type="text"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={pending || !bankComplete()}
                onClick={() => submitBankInfo(true)}
                className="mt-2 self-start rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                次へ
              </button>
            </div>
          ) : null}

          {wizardStep === "done" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">お疲れ様でした。手続きは以上です。</p>
              <button
                type="button"
                onClick={finishWizard}
                className="self-start rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                閉じる
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {showDetail && activePending ? (
        <TemplateModal
          readOnly
          companyName={companyName}
          clients={[]}
          editingTemplate={activePending.templateDetail}
          onClose={() => setShowDetail(false)}
        />
      ) : null}

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">契約中の雇用契約書</h2>
        {currentContracts.length === 0 ? (
          <p className="text-sm text-muted">契約はまだありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {currentContracts.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                <div>
                  <p>{c.title}</p>
                  <p className="text-xs text-muted">雇用開始日: {c.contractStartDate}</p>
                </div>
                <span className="text-muted">
                  {WAGE_TYPE_LABEL[c.wageType]} {c.wageAmountSnapshot}円 ／ {STATUS_LABEL[c.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pastContracts.length > 0 ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowPastContracts((v) => !v)}
              className="text-xs text-muted hover:text-primary"
            >
              {showPastContracts ? "▲ 過去の契約を閉じる" : `▼ 過去の契約（${pastContracts.length}件）`}
            </button>
            {showPastContracts ? (
              <ul className="mt-2 flex flex-col gap-2">
                {pastContracts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 p-3 text-sm"
                  >
                    <div>
                      <p>{c.title}</p>
                      <p className="text-xs text-muted">雇用開始日: {c.contractStartDate}</p>
                    </div>
                    <span className="text-muted">
                      {WAGE_TYPE_LABEL[c.wageType]} {c.wageAmountSnapshot}円 ／ {STATUS_LABEL[c.status]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      {baseWage || taskRates.length > 0 ? (
        <section className="rounded-2xl border border-border bg-white/60 p-6">
          <h2 className="mb-1 font-serif-jp text-lg font-bold text-primary">単価</h2>
          <p className="mb-4 text-xs text-muted">閲覧のみです。変更は会社にお問い合わせください。</p>
          <ul className="flex flex-col gap-2">
            {baseWage ? (
              <li className="rounded-lg border border-border bg-background/40 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    基本給・{baseWage.employmentTypeLabel}{" "}
                    <span className="text-xs font-normal text-muted">（{baseWage.jobDescription}）</span>
                  </span>
                  <span className="text-muted">{baseWage.currentLabel}</span>
                </div>
                {baseWage.versions.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedRateId(expandedRateId === "__base__" ? null : "__base__")}
                    className="mt-2 text-xs text-muted hover:text-primary"
                  >
                    {expandedRateId === "__base__" ? "▲ 履歴を閉じる" : `▼ 履歴（${baseWage.versions.length}件）`}
                  </button>
                ) : null}
                {expandedRateId === "__base__" ? (
                  <ul className="mt-2 flex flex-col text-xs text-muted">
                    {baseWage.versions.map((v) => (
                      <li key={v.id} className="flex items-center justify-between border-t border-border/50 py-1">
                        <span>{v.effectiveFrom} 〜</span>
                        <span>{v.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ) : null}
            {taskRates.map((r) => (
              <li key={r.id} className="rounded-lg border border-border/60 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {r.workplaceLabel} <span className="text-xs font-normal text-muted">（{r.taskName}）</span>
                  </span>
                  <span className="text-muted">{r.currentLabel}</span>
                </div>
                {r.versions.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedRateId(expandedRateId === r.id ? null : r.id)}
                    className="mt-2 text-xs text-muted hover:text-primary"
                  >
                    {expandedRateId === r.id ? "▲ 履歴を閉じる" : `▼ 履歴（${r.versions.length}件）`}
                  </button>
                ) : null}
                {expandedRateId === r.id ? (
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
          </ul>
        </section>
      ) : null}

      {clientNames.length > 0 ? (
        <section className="rounded-2xl border border-border bg-white/60 p-6">
          <h2 className="mb-1 font-serif-jp text-lg font-bold text-primary">配属先一覧</h2>
          <p className="mb-4 text-xs text-muted">{companyName}が業務を受けている依頼主です（参考情報）。</p>
          <ul className="flex flex-wrap gap-2">
            {clientNames.map((name, i) => (
              <li key={i} className="rounded-full border border-border/60 bg-background/40 px-3 py-1.5 text-xs">
                {name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-border p-3 text-sm">
        <div className="flex items-center justify-between">
          <p className="font-semibold">本人確認書類</p>
          <button type="button" onClick={() => setIdEditing((v) => !v)} className="text-xs text-primary hover:underline">
            アップロード
          </button>
        </div>
        <div className="mt-1 flex flex-col gap-1">
          {(["front", "back"] as const).map((side) => {
            const url = side === "front" ? frontUrl : backUrl;
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
        {idEditing ? (
          <div className="mt-4 flex gap-6 border-t border-border/60 pt-4">
            <div className="w-40">
              <ImageDropzone label="表面" required imageUrl={frontUrl} onChange={(url) => uploadIdDocument("front", url)} />
            </div>
            <div className="w-40">
              <ImageDropzone label="裏面" required imageUrl={backUrl} onChange={(url) => uploadIdDocument("back", url)} />
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border p-3 text-sm">
        <div className="flex items-center justify-between">
          <p className="font-semibold">振込先情報</p>
          <button type="button" onClick={() => setBankEditing((v) => !v)} className="text-xs text-primary hover:underline">
            {saved ? "保存しました" : bankName ? "編集" : "登録"}
          </button>
        </div>
        {bankName ? (
          <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
            <span>
              {bankName} {branchName}（{accountType}）
            </span>
            <span>口座番号: {accountNumber}</span>
            <span>口座名義: {accountHolderName}</span>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted">未設定</p>
        )}
        {bankEditing ? (
          <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4">
            <label className="flex flex-col gap-1 text-xs text-muted">
              銀行名
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              支店名
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              口座種別
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
              >
                <option value="">未選択</option>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              口座番号
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              口座名義
              <input
                type="text"
                value={accountHolderName}
                onChange={(e) => setAccountHolderName(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => submitBankInfo(false)}
              className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              保存する
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

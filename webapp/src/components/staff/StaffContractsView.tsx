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

type WizardStep = "review" | "id" | "bank" | "done";

export function StaffContractsView({
  companyName,
  myContracts,
  pendingContracts,
  idDocumentFrontUrl,
  idDocumentBackUrl,
  bankInfo,
}: {
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

  // 同意アクションはrevalidatePathでこのページのサーバーデータを更新する
  // ため、pendingContractsのpropsはウィザードの途中でも変わりうる。ウィザ
  // ードの進行状態がその変化に巻き込まれて消えてしまわないよう、対象一覧は
  // マウント時に一度だけ固定し、以後はローカルのインデックスだけで進める。
  const [queue] = useState(() => pendingContracts);
  const [queueIndex, setQueueIndex] = useState(0);
  const activePending = queue[queueIndex] ?? null;
  const [wizardStep, setWizardStep] = useState<WizardStep>("review");
  const [showDetail, setShowDetail] = useState(false);

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
      await consentContractAction(id);
      setWizardStep(nextStepAfter("review"));
    });
  }

  function uploadIdDocument(side: "front" | "back", url: string) {
    if (side === "front") setFrontUrl(url);
    else setBackUrl(url);
    startTransition(() => updateMyIdDocumentAction(side, url));
  }

  function submitBankInfo(advance: boolean) {
    setSaved(false);
    startTransition(async () => {
      await updateMyBankInfoAction({ bankName, branchName, accountType, accountNumber, accountHolderName });
      if (advance) {
        setWizardStep("done");
      } else {
        setSaved(true);
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
        {myContracts.length === 0 ? (
          <p className="text-sm text-muted">契約はまだありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {myContracts.map((c) => (
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
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-2 font-serif-jp text-lg font-bold text-primary">本人確認書類</h2>
        <p className="mb-4 text-xs text-muted">運転免許証など、両面の写真を提出してください。</p>
        {frontUrl || backUrl ? (
          <p className="mb-3 text-xs text-muted">再アップロードする場合のみ画像をクリックしてください</p>
        ) : null}
        <div className="flex gap-6">
          <div className="w-40">
            <ImageDropzone label="表面" required imageUrl={frontUrl} onChange={(url) => uploadIdDocument("front", url)} />
          </div>
          <div className="w-40">
            <ImageDropzone label="裏面" required imageUrl={backUrl} onChange={(url) => uploadIdDocument("back", url)} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">振込先情報</h2>
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
            disabled={pending}
            onClick={() => submitBankInfo(false)}
            className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saved ? "保存しました" : "保存する"}
          </button>
        </div>
      </section>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { startContractAction } from "@/app/staff/contracts/actions";
import { updateMyIdDocumentAction, updateMyBankInfoAction } from "@/app/staff/actions";
import { ImageDropzone } from "@/components/ImageDropzone";

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

export function StaffContractsView({
  myContracts,
  availableTemplates,
  idDocumentFrontUrl,
  idDocumentBackUrl,
  bankInfo,
}: {
  myContracts: {
    id: string;
    title: string;
    status: string;
    wageAmountSnapshot: number;
    wageType: string;
    contractStartDate: string;
  }[];
  availableTemplates: { id: string; title: string; wageType: string; wageAmount: number }[];
  idDocumentFrontUrl: string | null;
  idDocumentBackUrl: string | null;
  bankInfo: BankInfo;
}) {
  const [pending, startTransition] = useTransition();
  const [bankName, setBankName] = useState(bankInfo.bankName);
  const [branchName, setBranchName] = useState(bankInfo.branchName);
  const [accountType, setAccountType] = useState(bankInfo.accountType);
  const [accountNumber, setAccountNumber] = useState(bankInfo.accountNumber);
  const [accountHolderName, setAccountHolderName] = useState(bankInfo.accountHolderName);
  const [saved, setSaved] = useState(false);

  function submitBankInfo() {
    setSaved(false);
    startTransition(async () => {
      await updateMyBankInfoAction({ bankName, branchName, accountType, accountNumber, accountHolderName });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  return (
    <div className="flex flex-col gap-8">
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
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">契約を結ぶ</h2>
        {availableTemplates.length === 0 ? (
          <p className="text-sm text-muted">結べる契約書テンプレートはありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {availableTemplates.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                <span>
                  {t.title} — {WAGE_TYPE_LABEL[t.wageType]} {t.wageAmount}円
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => startContractAction(t.id))}
                  className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  契約を結ぶ
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-2 font-serif-jp text-lg font-bold text-primary">本人確認書類</h2>
        <p className="mb-4 text-xs text-muted">運転免許証など、両面の写真を提出してください。</p>
        <div className="flex gap-6">
          <ImageDropzone
            label="表面"
            required
            imageUrl={idDocumentFrontUrl ?? ""}
            onChange={(url) => startTransition(() => updateMyIdDocumentAction("front", url))}
          />
          <ImageDropzone
            label="裏面"
            required
            imageUrl={idDocumentBackUrl ?? ""}
            onChange={(url) => startTransition(() => updateMyIdDocumentAction("back", url))}
          />
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
            onClick={submitBankInfo}
            className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saved ? "保存しました" : "保存する"}
          </button>
        </div>
      </section>
    </div>
  );
}

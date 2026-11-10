"use client";

import { useState, useTransition } from "react";
import { consentContractAction } from "@/app/staff/contracts/actions";
import { updateMyIdDocumentAction, updateMyBankInfoAction } from "@/app/staff/actions";
import { ImageDropzone } from "@/components/ImageDropzone";
import { TemplateModal, type Template } from "@/components/company/ContractsView";

export type ContractConsentData = {
  companyId: string;
  companyName: string;
  myName: string;
  address: string;
  phoneNumber: string;
  idDocumentFrontUrl: string;
  idDocumentBackUrl: string;
  bankInfo: { bankName: string; branchName: string; accountType: string; accountNumber: string; accountHolderName: string };
  contracts: {
    id: string;
    title: string;
    templateDetail: Template;
    requireIdDocument: boolean;
    requireBankInfo: boolean;
  }[];
};

type Step = "contract" | "id" | "bank" | "sign";

const STEP_LABEL: Record<Step, string> = {
  contract: "契約書の内容",
  id: "身分証明書の添付",
  bank: "振込先情報",
  sign: "署名",
};

// 確認待ちの契約書を、その場で全画面で開いて最後まで済ませる流れ。
// 契約書の内容 → 身分証明書の添付 → 振込先情報 → 署名（同意）の順。身分証・振込先は
// その契約書で必須にしているときだけ出す。提出済みの内容は最初から入っていて、直すこともできる。
// 身分証は選んだ時点で、振込先は「次へ」で保存するので、途中で閉じても続きから再開できる。
// 確認待ちが複数あれば、続けて次の契約書を開く。全部済んだらonFinishedを呼ぶ。
export function ContractConsentWizard({
  data,
  onClose,
  onFinished,
}: {
  data: ContractConsentData;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [contractIndex, setContractIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [frontUrl, setFrontUrl] = useState(data.idDocumentFrontUrl);
  const [backUrl, setBackUrl] = useState(data.idDocumentBackUrl);
  const [bank, setBank] = useState(data.bankInfo);
  const [name, setName] = useState(data.myName);
  const [address, setAddress] = useState(data.address);
  const [phoneNumber, setPhoneNumber] = useState(data.phoneNumber);
  const [error, setError] = useState<string | null>(null);

  const contract = data.contracts[contractIndex];
  if (!contract) return null;
  const steps: Step[] = [
    "contract",
    ...(contract.requireIdDocument ? (["id"] as Step[]) : []),
    ...(contract.requireBankInfo ? (["bank"] as Step[]) : []),
    "sign",
  ];
  const step = steps[stepIndex];

  const idComplete = frontUrl !== "" && backUrl !== "";
  const bankComplete = bank.bankName.trim() !== "" && bank.accountNumber.trim() !== "" && bank.accountHolderName.trim() !== "";
  const signComplete = name.trim() !== "" && address.trim() !== "" && phoneNumber.trim() !== "";

  function scrollTop() {
    document.getElementById("contract-consent-body")?.scrollTo({ top: 0 });
  }
  function goNext() {
    setError(null);
    setStepIndex((i) => i + 1);
    scrollTop();
  }
  function goBack() {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
    scrollTop();
  }

  function uploadIdDocument(side: "front" | "back", url: string) {
    if (side === "front") setFrontUrl(url);
    else setBackUrl(url);
    startTransition(() => updateMyIdDocumentAction(data.companyId, side, url));
  }

  function saveBankAndNext() {
    setError(null);
    startTransition(async () => {
      try {
        await updateMyBankInfoAction(data.companyId, bank);
        goNext();
      } catch {
        setError("保存できませんでした。もう一度お試しください。");
      }
    });
  }

  function consent() {
    setError(null);
    startTransition(async () => {
      try {
        await consentContractAction(contract.id, data.companyId, {
          name: name.trim(),
          address: address.trim(),
          phoneNumber: phoneNumber.trim(),
        });
        if (contractIndex + 1 < data.contracts.length) {
          setContractIndex((i) => i + 1);
          setStepIndex(0);
          scrollTop();
        } else {
          onFinished();
        }
      } catch {
        setError("同意できませんでした。入力内容を確かめて、もう一度お試しください。");
      }
    });
  }

  const field = "rounded-lg border border-border px-3 py-2 text-sm text-foreground";

  return (
    <div role="dialog" aria-modal="true" aria-label="契約書の確認" className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="border-b border-border px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top)*1.5)]">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-muted">
            {data.companyName}
            {data.contracts.length > 1 ? `（契約書 ${contractIndex + 1}/${data.contracts.length}）` : ""}
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" className="shrink-0 px-2 text-muted">
            ✕
          </button>
        </div>
        <p className="mt-1 font-serif-jp text-lg font-bold text-primary">
          {stepIndex + 1}/{steps.length} {STEP_LABEL[step]}
        </p>
        <div className="mt-2 flex gap-1" aria-hidden>
          {steps.map((s, i) => (
            <span key={s} className={`h-1 flex-1 rounded-full ${i <= stepIndex ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>
      </div>

      <div id="contract-consent-body" className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto w-full max-w-3xl">
          {step === "contract" ? (
            <>
              <p className="mb-3 text-xs text-muted">最後まで読んで「次へ」を押してください。</p>
              <TemplateModal
                embedded
                readOnly
                companyName={data.companyName}
                clients={[]}
                editingTemplate={contract.templateDetail}
                viewingStaff={{ name: data.myName }}
                onClose={onClose}
              />
            </>
          ) : null}

          {step === "id" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground/80">運転免許証など、本人確認書類の両面の写真を添付してください。</p>
              {idComplete ? <p className="text-xs font-semibold text-emerald-700">提出済みです。撮り直す場合は画像を選び直してください。</p> : null}
              <div className="flex gap-4">
                <div className="w-40">
                  <ImageDropzone label="表面" required imageUrl={frontUrl} onChange={(url) => uploadIdDocument("front", url)} />
                </div>
                <div className="w-40">
                  <ImageDropzone label="裏面" required imageUrl={backUrl} onChange={(url) => uploadIdDocument("back", url)} />
                </div>
              </div>
            </div>
          ) : null}

          {step === "bank" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground/80">給料の振込先を入力してください。登録済みの内容は直すこともできます。</p>
              {(
                [
                  ["bankName", "銀行名"],
                  ["branchName", "支店名"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-xs">
                  <span className="text-muted">{label}</span>
                  <input type="text" value={bank[key]} onChange={(e) => setBank({ ...bank, [key]: e.target.value })} className={field} />
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted">口座種別</span>
                <select value={bank.accountType} onChange={(e) => setBank({ ...bank, accountType: e.target.value })} className={field}>
                  <option value="">未選択</option>
                  <option value="普通">普通</option>
                  <option value="当座">当座</option>
                </select>
              </label>
              {(
                [
                  ["accountNumber", "口座番号"],
                  ["accountHolderName", "口座名義"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-xs">
                  <span className="text-muted">{label}</span>
                  <input type="text" value={bank[key]} onChange={(e) => setBank({ ...bank, [key]: e.target.value })} className={field} />
                </label>
              ))}
            </div>
          ) : null}

          {step === "sign" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground/80">
                契約書の内容を確認しました。氏名・住所・電話番号を入力のうえ同意してください（署名の代わりになります）。
              </p>
              <label className="flex flex-col gap-1 text-xs">
                <span>
                  氏名<span className="text-red-600"> *</span>
                </span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span>
                  住所<span className="text-red-600"> *</span>
                </span>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span>
                  電話番号<span className="text-red-600"> *</span>
                </span>
                <input type="text" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={field} />
              </label>
              <p className="text-xs text-muted">直した住所・電話番号は、登録済みの内容にも反映されます。</p>
            </div>
          ) : null}

          {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

          <div className="mt-6 flex gap-2 pb-[env(safe-area-inset-bottom)]">
            {stepIndex > 0 ? (
              <button type="button" onClick={goBack} className="rounded-lg border border-border px-4 py-2.5 text-sm">
                戻る
              </button>
            ) : null}
            {step === "sign" ? (
              <button
                type="button"
                disabled={pending || !signComplete}
                onClick={consent}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                内容を確認しました（同意する）
              </button>
            ) : (
              <button
                type="button"
                disabled={pending || (step === "id" && !idComplete) || (step === "bank" && !bankComplete)}
                onClick={step === "bank" ? saveBankAndNext : goNext}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                次へ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { todayJst } from "@/lib/date";
import {
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
  generateStaffContractAction,
  generateStaffContractFromUploadAction,
  assignExistingTemplateAction,
  assignUploadOnlyTemplateAction,
} from "@/app/company/contracts/actions";
import { ImageDropzone } from "@/components/ImageDropzone";

export type Template = {
  id: string;
  title: string;
  employmentType: string;
  workplaceType: string | null;
  workplaceNote: string | null;
  clientName: string | null;
  jobDescription: string;
  scheduleType: string | null;
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
  contractPeriodType: string | null;
  contractStartDate: string;
  contractEndDate: string | null;
  extraItems: { label: string; value: string }[];
  status: string;
  contractedStaffNames: string[];
};

// 「アップロードのみ」専用の軽量テンプレート — 雇用形態・業務内容・基本給・
// 契約開始日だけを持つ、通常のテンプレート一覧には出さない再利用候補。
export type UploadOnlyTemplate = {
  id: string;
  title: string;
  employmentTypeLabel: string;
  jobDescription: string;
  wageLabel: string;
  contractStartDate: string;
};

export type ClientOption = { id: string; name: string };

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

function formatSignedAt(isoString: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(isoString));
}

export function ContractsView({
  templates,
  clients,
  companyName,
}: {
  templates: Template[];
  clients: ClientOption[];
  companyName: string;
}) {
  return (
    <div className="flex flex-col gap-10">
      <TemplatesSection templates={templates} clients={clients} companyName={companyName} />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
      <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">{title}</h2>
      {children}
    </section>
  );
}

function TemplatesSection({
  templates,
  clients,
  companyName,
}: {
  templates: Template[];
  clients: ClientOption[];
  companyName: string;
}) {
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [expandedStaffListIds, setExpandedStaffListIds] = useState<Set<string>>(new Set());
  function toggleStaffList(templateId: string) {
    setExpandedStaffListIds((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  }

  return (
    <SectionCard title="雇用契約書テンプレート">
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="mb-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        ＋テンプレートを作成
      </button>

      {showModal ? (
        <TemplateModal clients={clients} companyName={companyName} onClose={() => setShowModal(false)} />
      ) : null}
      {editingTemplate ? (
        <TemplateModal
          clients={clients}
          companyName={companyName}
          editingTemplate={editingTemplate}
          onClose={() => setEditingTemplate(null)}
        />
      ) : null}

      <ul className="mt-4 flex flex-col gap-3">
        {templates.map((t) => (
          <li key={t.id} className="rounded-xl border border-border/60 p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium">{t.title}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  t.status === "LOCKED" ? "bg-accent/20 text-accent" : "bg-primary/10 text-primary"
                }`}
              >
                {t.status === "LOCKED" ? "使用中（編集は複製されます）" : "編集可能"}
              </span>
            </div>
            <p className="text-sm text-muted">
              {EMPLOYMENT_TYPE_LABEL[t.employmentType]} ／{" "}
              {t.workplaceType === "CLIENT" ? t.clientName ?? "配属先" : "自社"} ／{" "}
              {WAGE_TYPE_LABEL[t.wageType]} {t.wageAmount}円
            </p>
            {t.contractedStaffNames.length > 0 ? (
              <div className="text-xs text-muted">
                <button type="button" onClick={() => toggleStaffList(t.id)} className="hover:text-primary">
                  {expandedStaffListIds.has(t.id) ? "▲" : "▼"} 契約中（{t.contractedStaffNames.length}件）
                </button>
                {expandedStaffListIds.has(t.id) ? <p className="mt-1">{t.contractedStaffNames.join("、")}</p> : null}
              </div>
            ) : null}

            {confirmDeleteId === t.id ? (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-red-600">本当に削除しますか？</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(async () => {
                    await deleteTemplateAction(t.id);
                    setConfirmDeleteId(null);
                  })}
                  className="rounded-lg bg-red-600 px-2 py-1 font-semibold text-white disabled:opacity-60"
                >
                  削除する
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-muted underline">
                  キャンセル
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-3 text-xs">
                <button type="button" onClick={() => setEditingTemplate(t)} className="text-primary underline">
                  編集
                </button>
                {t.status !== "LOCKED" ? (
                  <button type="button" onClick={() => setConfirmDeleteId(t.id)} className="text-red-600 underline">
                    削除
                  </button>
                ) : null}
              </div>
            )}
          </li>
        ))}
        {templates.length === 0 ? (
          <p className="text-sm text-muted">テンプレートがありません。</p>
        ) : null}
      </ul>
    </SectionCard>
  );
}

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
  { value: 0, label: "日" },
];

const QUICK_ADD_CHIPS = [
  "交通費",
  "試用期間",
  "社会保険",
  "雇用保険",
  "昇給",
  "賞与",
  "有給の有無",
  "退職・契約解除に関する事項",
  "就業規則",
];

function ToggleGroup<T extends string | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${
            value === o.value
              ? "border-primary bg-primary/10 font-semibold text-primary"
              : "border-border text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2.5">
      <span className="w-28 shrink-0 pt-2 text-[10px] font-semibold text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const fieldInput = "w-full min-w-0 rounded-lg border border-border px-2 py-2 text-sm";

// 「契約書を生成」フローの1段階目 — ベースにするテンプレートを選ぶ。ダッシュ
// ボードの「契約書未確認」とスタッフ詳細の両方から使う共有モーダル。
// 「契約書管理」の入口 — まず「契約書を生成」（本人に確認・同意してもらう
// 通常フロー）と「アップロード」（既に書面で契約済み、署名済み書面を添付
// するだけのフロー）のどちらにするかを最初に選ばせる。以前はアップロード
// が生成フローの3番目の選択肢として埋もれていて分かりにくかったための変更。
export function GenerateOrUploadChoiceModal({
  staffName,
  onGenerate,
  onUpload,
  onClose,
}: {
  staffName: string;
  onGenerate: () => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">契約書管理</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">{staffName}さんの契約書をどちらで用意しますか？</p>
        <button
          type="button"
          onClick={onGenerate}
          className="w-full rounded-lg border border-border px-4 py-3 text-left text-sm font-semibold text-primary hover:border-primary"
        >
          契約書を生成
          <span className="mt-1 block text-xs font-normal text-muted">
            テンプレートから契約書を作り、本人に内容を確認・同意してもらいます
          </span>
        </button>
        <button
          type="button"
          onClick={onUpload}
          className="mt-2 w-full rounded-lg border border-border px-4 py-3 text-left text-sm font-semibold text-primary hover:border-primary"
        >
          アップロード
          <span className="mt-1 block text-xs font-normal text-muted">
            既に書面で契約済みのスタッフ向け。署名済みの契約書を添付して記録します
          </span>
        </button>
      </div>
    </div>
  );
}

export function ChooseBaseTemplateModal({
  staffName,
  templates,
  existingContractCount = 0,
  onNext,
  onClose,
}: {
  staffName: string;
  templates: Template[];
  existingContractCount?: number;
  onNext: (template: Template) => void;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const selected = templates.find((t) => t.id === templateId) ?? null;
  const needsAcknowledgement = existingContractCount > 0;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">契約書を生成</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          テンプレートを選んでください。そのまま{staffName}さんに割り当てるか、内容を編集して専用の契約書を作るか次の画面で選べます
        </p>

        {needsAcknowledgement ? (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            ⚠️ {staffName}さんには既に有効な契約が{existingContractCount}件あります。同じスタッフに複数の契約が同時に有効だと、給与計算で意図しない方の単価が使われる場合があります。通常は先に既存の契約を終了してから新しい契約を作成してください。
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              内容を理解した上で続ける
            </label>
          </div>
        ) : null}

        {templates.length === 0 ? (
          <p className="text-sm text-muted">利用できる契約書テンプレートがありません。先にテンプレートを作成してください。</p>
        ) : (
          <label className="flex flex-col gap-1 text-xs">
            <span>
              テンプレート<span className="text-red-600"> *</span>
            </span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            >
              <option value="">選択してください</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          disabled={!selected || (needsAcknowledgement && !acknowledged)}
          onClick={() => selected && onNext(selected)}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          次へ
        </button>
      </div>
    </div>
  );
}

// テンプレートを選んだ後の分岐: 内容を変えないなら複製せずそのまま割り当て
// る（同じテンプレートを複数人で共有できる — 設定画面の「契約中」欄に
// 名前が並ぶ）。内容を変えたい場合だけ、従来通り複製して編集する。
export function AssignOrCustomizeModal({
  staffName,
  staffUserId,
  template,
  onAssigned,
  onCustomize,
  onClose,
}: {
  staffName: string;
  staffUserId: string;
  template: Template;
  onAssigned: () => void;
  onCustomize: () => void;
  onClose: () => void;
}) {
  const [contractStartDate, setContractStartDate] = useState(todayJst());
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      await assignExistingTemplateAction(template.id, staffUserId, contractStartDate);
      onAssigned();
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">{staffName}さんとの契約</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <div className="mb-4 rounded-lg border border-border/60 p-3 text-sm">
          <p className="font-medium">{template.title}</p>
          <p className="text-muted">
            {WAGE_TYPE_LABEL[template.wageType]}
            {template.wageAmount}円
          </p>
        </div>

        <label className="flex flex-col gap-1 text-xs">
          <span>
            契約開始日<span className="text-red-600"> *</span>
          </span>
          <input
            type="date"
            value={contractStartDate}
            onChange={(e) => setContractStartDate(e.target.value)}
            className="rounded-lg border border-border px-2 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={pending || !contractStartDate}
          onClick={submit}
          className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          このテンプレートのまま契約する
        </button>
        <button
          type="button"
          onClick={onCustomize}
          className="mt-2 w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary"
        >
          内容を編集して専用の契約書を作る
        </button>
        <p className="mt-2 text-xs text-muted">
          「このテンプレートのまま」を選ぶと、他の人と同じテンプレートを共有します（設定画面の契約書テンプレート一覧の「契約中」欄に追加されます）。内容を変えたい場合は編集を選んでください。
        </p>
      </div>
    </div>
  );
}

// 「アップロード」経路: 既に書面で契約済みのスタッフ向け。署名済み書面は
// それ自体が正式な記録なので、アプリ側で契約書本文を再現する必要は無く、
// 給与計算に要る最小限（雇用形態・業務内容・基本給・契約開始日）だけを
// 入力させる。氏名は名簿の氏名で足りるため聞かない — 本人確認が要る場面
// では添付した署名済み書面そのものを見ればよい。住所・電話番号・有給・
// 本人確認書類・振込先情報・業務単価は、ここでは触れず保存後に案内する
// （それぞれ既存の専用画面がある）。
export function UploadContractModal({
  staffName,
  staffUserId,
  uploadOnlyTemplates,
  onDone,
  onClose,
}: {
  staffName: string;
  staffUserId: string;
  uploadOnlyTemplates: UploadOnlyTemplate[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"pick" | "new">(uploadOnlyTemplates.length > 0 ? "pick" : "new");
  const [templateId, setTemplateId] = useState("");
  const [employmentType, setEmploymentType] = useState("PART_TIME");
  const [jobDescription, setJobDescription] = useState("");
  const [wageType, setWageType] = useState("HOURLY");
  const [wageAmount, setWageAmount] = useState("");
  const [contractStartDate, setContractStartDate] = useState(todayJst());
  const [uploadedDocumentUrl, setUploadedDocumentUrl] = useState("");
  const [partyAddress, setPartyAddress] = useState("");
  const [partyPhoneNumber, setPartyPhoneNumber] = useState("");

  const canSubmit =
    Boolean(uploadedDocumentUrl) &&
    (mode === "pick"
      ? Boolean(templateId)
      : Boolean(jobDescription) && Number(wageAmount) > 0 && Boolean(contractStartDate));

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const party = { address: partyAddress.trim() || undefined, phoneNumber: partyPhoneNumber.trim() || undefined };
        if (mode === "pick") {
          await assignUploadOnlyTemplateAction(templateId, staffUserId, uploadedDocumentUrl, party);
        } else {
          await generateStaffContractFromUploadAction(
            {
              title: `${EMPLOYMENT_TYPE_LABEL[employmentType]}・${jobDescription}`,
              employmentType: employmentType as never,
              jobDescription,
              wageType: wageType as never,
              wageAmount: Number(wageAmount),
              contractStartDate: new Date(`${contractStartDate}T00:00:00.000Z`),
            },
            staffUserId,
            uploadedDocumentUrl,
            party,
          );
        }
        onDone();
      } catch {
        setError("保存できませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">アップロード（{staffName}様）</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          本人への同意依頼は送られません。既に署名済みの契約書（写真・PDF）を添付してください。
        </p>

        {uploadOnlyTemplates.length > 0 ? (
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("pick")}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${
                mode === "pick" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted"
              }`}
            >
              既存の条件から選ぶ
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${
                mode === "new" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted"
              }`}
            >
              ＋新しい条件を入力
            </button>
          </div>
        ) : null}

        {mode === "pick" ? (
          <label className="mb-4 flex flex-col gap-1 text-xs">
            <span>
              雇用条件<span className="text-red-600"> *</span>
            </span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            >
              <option value="">選択してください</option>
              {uploadOnlyTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="mb-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span>
                雇用形態<span className="text-red-600"> *</span>
              </span>
              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              >
                {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span>
                業務内容<span className="text-red-600"> *</span>
              </span>
              <input
                type="text"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span>
                基本給<span className="text-red-600"> *</span>
              </span>
              <div className="flex gap-2">
                <select
                  value={wageType}
                  onChange={(e) => setWageType(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                >
                  {Object.entries(WAGE_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={wageAmount}
                  onChange={(e) => setWageAmount(e.target.value)}
                  placeholder="金額"
                  className="w-full rounded-lg border border-border px-2 py-2 text-sm"
                />
                <span className="flex items-center text-sm text-muted">円</span>
              </div>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span>
                契約開始日（入社日）<span className="text-red-600"> *</span>
              </span>
              <input
                type="date"
                value={contractStartDate}
                onChange={(e) => setContractStartDate(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
          </div>
        )}

        <div className="mb-4">
          <ImageDropzone
            label="署名済み書面"
            required
            accept="image/*,application/pdf"
            imageUrl={uploadedDocumentUrl}
            onChange={setUploadedDocumentUrl}
            size="md"
          />
        </div>

        <details className="mb-4 rounded-lg border border-border/60 p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-muted">住所・電話番号を入力する（任意）</summary>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              住所
              <input
                type="text"
                value={partyAddress}
                onChange={(e) => setPartyAddress(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              電話番号
              <input
                type="text"
                value={partyPhoneNumber}
                onChange={(e) => setPartyPhoneNumber(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
          </div>
        </details>

        {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
        <button
          type="button"
          disabled={pending || !canSubmit}
          onClick={submit}
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          保存する
        </button>
      </div>
    </div>
  );
}

// 「アップロード」経路で作った契約の「詳細確認」。署名済み書面そのものが
// 正式な記録のため、契約書本文風の表示はせず、給与計算に使う必須項目と
// アップロードした書面を開くリンクだけを見せるシンプルな画面。
export function UploadOnlyContractDetail({
  staffName,
  contract,
  onClose,
}: {
  staffName: string;
  contract: {
    employmentTypeLabel: string;
    jobDescription: string;
    wageLabel: string;
    contractStartDate: string;
    uploadedDocumentUrl: string | null;
  };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">アップロードされた契約書（{staffName}様）</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          書面で契約済みのため、内容は添付された署名済み書面が正式な記録です。ここでは給与計算に使う項目のみ表示します。
        </p>
        <div className="flex flex-col divide-y divide-border/40 text-sm">
          <div className="flex items-center justify-between py-2">
            <span className="text-muted">雇用形態</span>
            <span>{contract.employmentTypeLabel}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-muted">業務内容</span>
            <span>{contract.jobDescription}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-muted">基本給</span>
            <span>{contract.wageLabel}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-muted">契約開始日</span>
            <span>{contract.contractStartDate}</span>
          </div>
        </div>
        {contract.uploadedDocumentUrl ? (
          <a
            href={contract.uploadedDocumentUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block rounded-lg border border-primary px-4 py-2 text-center text-sm font-semibold text-primary hover:bg-primary/5"
          >
            📄 アップロードされた署名済み書面を見る
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function TemplateModal({
  clients,
  companyName,
  editingTemplate,
  generateForStaff,
  viewingStaff,
  duplicateAsNew,
  consentForm,
  onClose,
  onSaved,
  readOnly,
}: {
  clients: ClientOption[];
  companyName: string;
  editingTemplate?: Template;
  generateForStaff?: { userId: string; name: string };
  // readOnlyで既存の契約書を見るだけの時に、その契約の相手方（乙）の
  // 氏名・住所・電話番号を表示するための情報。generateForStaffと違い
  // 生成フロー（タイトル表示・送信先）には一切影響しない。
  viewingStaff?: { name: string; address?: string; phoneNumber?: string; consentedAt?: string | null };
  // PENDING_CONSENTの契約をスタッフ本人が全文確認した末尾に出す、氏名・
  // 住所・電話番号の入力欄＋同意ボタン。これが渡された場合のみ、readOnly
  // でも末尾にこのフォームを表示する（「見てません」防止のため、全文を
  // 開かないと同意できない動線にするのが目的）。
  consentForm?: {
    pending: boolean;
    error?: string | null;
    onConsent: (party: { name: string; address: string; phoneNumber: string }) => void;
  };
  // trueの場合、editingTemplateの内容を初期値として引き継ぎつつ、更新では
  // なく新規の独立したテンプレートとして保存する（招待モーダルからの
  // 「このテンプレートを複製して新規作成」用）。
  duplicateAsNew?: boolean;
  onClose: () => void;
  // 新規作成・複製が完了した時に作成されたテンプレートを受け取る（招待
  // モーダル側でセレクトを自動選択させるために使う）。
  onSaved?: (template: { id: string; title: string }) => void;
  // 契約内容の閲覧専用（スタッフ詳細＞契約書管理の「詳細確認」）。常にプレビュー
  // 表示に固定し、編集・保存のボタンを出さない — 誤って共有テンプレートを
  // 書き換えてしまわないようにするため。
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [customTitle, setCustomTitle] = useState(
    generateForStaff && editingTemplate
      ? `${editingTemplate.title}（${generateForStaff.name}様）`
      : duplicateAsNew && editingTemplate
        ? `${editingTemplate.title}（複製）`
        : (editingTemplate?.title ?? ""),
  );
  const [employmentType, setEmploymentType] = useState(editingTemplate?.employmentType ?? "PART_TIME");
  const [workplaceNote, setWorkplaceNote] = useState(editingTemplate?.workplaceNote ?? "");
  const [jobDescription, setJobDescription] = useState(editingTemplate?.jobDescription ?? "");
  const [contractPeriodType, setContractPeriodType] = useState<"INDEFINITE" | "FIXED_TERM">(
    (editingTemplate?.contractPeriodType as "INDEFINITE" | "FIXED_TERM") ?? "INDEFINITE",
  );
  const [contractStartDate, setContractStartDate] = useState(
    editingTemplate?.contractStartDate ?? todayJst(),
  );
  const [contractEndDate, setContractEndDate] = useState(editingTemplate?.contractEndDate ?? "");
  const [wageType, setWageType] = useState(editingTemplate?.wageType ?? "HOURLY");
  const [wageAmount, setWageAmount] = useState(editingTemplate ? String(editingTemplate.wageAmount) : "");
  const [scheduleType, setScheduleType] = useState<"FIXED" | "SHIFT">(
    (editingTemplate?.scheduleType as "FIXED" | "SHIFT") ?? "FIXED",
  );
  const [workStartTime, setWorkStartTime] = useState(editingTemplate?.workStartTime ?? "");
  const [workEndTime, setWorkEndTime] = useState(editingTemplate?.workEndTime ?? "");
  const [actualWorkHours, setActualWorkHours] = useState(
    editingTemplate?.actualWorkMinutes ? String(editingTemplate.actualWorkMinutes / 60) : "8",
  );
  const [breakMinutes, setBreakMinutes] = useState(
    editingTemplate?.breakMinutes != null ? String(editingTemplate.breakMinutes) : "60",
  );
  const [hasOvertime, setHasOvertime] = useState(editingTemplate?.hasOvertime ?? false);
  const [overtimeNote, setOvertimeNote] = useState(editingTemplate?.overtimeNote ?? "");
  const [fixedWeekdays, setFixedWeekdays] = useState<number[]>(editingTemplate?.fixedWeekdays ?? []);
  const [shiftPatternNote, setShiftPatternNote] = useState(editingTemplate?.shiftPatternNote ?? "");
  const [restNote, setRestNote] = useState(editingTemplate?.restNote ?? "");
  const [paymentClosingDay, setPaymentClosingDay] = useState(editingTemplate?.paymentClosingDay ?? "");
  const [paymentDay, setPaymentDay] = useState(editingTemplate?.paymentDay ?? "");
  const [paymentMethod, setPaymentMethod] = useState(editingTemplate?.paymentMethod ?? "振込");
  const [extraItems, setExtraItems] = useState<{ label: string; value: string }[]>(
    editingTemplate?.extraItems ?? [],
  );
  const [customChipLabel, setCustomChipLabel] = useState("");
  const [customChipValue, setCustomChipValue] = useState("");
  const [showCustomChipForm, setShowCustomChipForm] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">(readOnly ? "preview" : "edit");
  // 同意フォーム（consentForm）用の入力欄。全文を確認した本人がここで
  // 氏名・住所・電話番号を入力してから同意する（署名代わり）。
  const [consentName, setConsentName] = useState(viewingStaff?.name ?? "");
  const [consentAddress, setConsentAddress] = useState("");
  const [consentPhoneNumber, setConsentPhoneNumber] = useState("");

  const autoTitle = `${EMPLOYMENT_TYPE_LABEL[employmentType]}${jobDescription ? "・" + jobDescription : ""}`;
  const title = customTitle.trim() || autoTitle;
  const preview = mode === "preview";
  // 契約相手方（乙）の表示用情報。generation中はgenerateForStaff、既存
  // 契約の閲覧中はviewingStaffを使う（お互いタイトル表示や送信先には
  // 影響しないよう完全に分離している）。
  const partyInfo: { name: string; address?: string; phoneNumber?: string; consentedAt?: string | null } | undefined =
    generateForStaff ? { name: generateForStaff.name } : viewingStaff;

  const workingDayLabel = WEEKDAYS.filter((d) => fixedWeekdays.includes(d.value))
    .map((d) => d.label)
    .join("・");
  const offDayLabel = WEEKDAYS.filter((d) => !fixedWeekdays.includes(d.value))
    .map((d) => d.label)
    .join("・");

  function toggleWeekday(v: number) {
    setFixedWeekdays((prev) => (prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v]));
  }

  function addChip(label: string, value = "") {
    setExtraItems((prev) => (prev.some((i) => i.label === label) ? prev : [...prev, { label, value }]));
  }

  function updateChipValue(label: string, value: string) {
    setExtraItems((prev) => prev.map((i) => (i.label === label ? { ...i, value } : i)));
  }

  function removeChip(label: string) {
    setExtraItems((prev) => prev.filter((i) => i.label !== label));
  }

  const canSubmit = Boolean(jobDescription) && Number(wageAmount) > 0;

  async function submitTemplate() {
    const payload = {
      title,
      employmentType: employmentType as never,
      workplaceType: (workplaceNote.trim() ? "CLIENT" : "INHOUSE") as never,
      workplaceNote: workplaceNote.trim() || undefined,
      jobDescription,
      scheduleType,
      workStartTime: scheduleType === "FIXED" ? workStartTime || undefined : undefined,
      workEndTime: scheduleType === "FIXED" ? workEndTime || undefined : undefined,
      actualWorkMinutes:
        scheduleType === "FIXED" && actualWorkHours ? Math.round(Number(actualWorkHours) * 60) : undefined,
      breakMinutes: scheduleType === "FIXED" && breakMinutes ? Number(breakMinutes) : undefined,
      hasOvertime,
      overtimeNote: hasOvertime ? overtimeNote || undefined : undefined,
      fixedWeekdays: scheduleType === "FIXED" ? fixedWeekdays : [],
      shiftPatternNote: scheduleType === "SHIFT" ? shiftPatternNote || undefined : undefined,
      restNote: restNote || undefined,
      wageType: wageType as never,
      wageAmount: Number(wageAmount),
      paymentClosingDay: paymentClosingDay || undefined,
      paymentDay: paymentDay || undefined,
      paymentMethod: paymentMethod || undefined,
      contractPeriodType,
      contractStartDate: new Date(`${contractStartDate}T00:00:00.000Z`),
      contractEndDate:
        contractPeriodType === "FIXED_TERM" && contractEndDate ? new Date(`${contractEndDate}T00:00:00.000Z`) : undefined,
      hasRenewal: false,
      extraItems,
    };

    if (generateForStaff) {
      await generateStaffContractAction(payload, generateForStaff.userId);
      return null;
    }
    if (editingTemplate && !duplicateAsNew) {
      await updateTemplateAction(editingTemplate.id, payload);
      return null;
    }
    return createTemplateAction(payload);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">
            {generateForStaff
              ? `契約書を生成${preview ? "" : "（" + generateForStaff.name + "様）"}`
              : `雇用契約書${preview ? "" : "テンプレート"}${
                  editingTemplate && !preview ? (duplicateAsNew ? "の複製" : "の編集") : ""
                }`}
          </h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        {generateForStaff && !preview ? (
          <p className="mb-3 text-xs text-muted">
            {editingTemplate ? `「${editingTemplate.title}」を複製し、` : ""}
            この内容を編集して{generateForStaff.name}さん専用の契約書として生成します
          </p>
        ) : null}

        {preview ? (
          readOnly ? null : <p className="mb-3 text-xs text-muted">テンプレート名：{title}</p>
        ) : (
          <label className="mb-3 flex flex-col gap-1 text-xs">
            テンプレート名（管理用・スタッフには表示されません）
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder={`未入力の場合、自動生成されます（例：${autoTitle}）`}
              className={fieldInput}
            />
          </label>
        )}

        <p className="text-sm leading-relaxed">
          {companyName}（以下「甲」）と{partyInfo?.name ?? "（スタッフ名/自動反映）"}（以下「乙」）は、
          {contractStartDate || "開始日未設定"}
          より、以下の内容で雇用契約を締結する。
        </p>
        {partyInfo?.consentedAt ? (
          <p className="mt-1 text-xs text-muted">
            署名日時：{formatSignedAt(partyInfo.consentedAt)}／氏名：{partyInfo.name}／住所：
            {partyInfo.address || "未登録"}／電話番号：{partyInfo.phoneNumber || "未登録"}
          </p>
        ) : partyInfo?.address || partyInfo?.phoneNumber ? (
          <p className="mt-1 text-xs text-muted">
            乙の住所・連絡先：{partyInfo.address || "未登録"}
            {partyInfo.phoneNumber ? ` ／ ${partyInfo.phoneNumber}` : ""}
          </p>
        ) : null}
        <div className="my-4 border-t border-border" />

        <div className="flex flex-col divide-y divide-border/40">
          <Row label="雇用形態">
            {preview ? (
              <span className="text-sm">{EMPLOYMENT_TYPE_LABEL[employmentType]}</span>
            ) : (
              <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className={fieldInput}>
                {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Row>

          <Row label="雇用開始日">
            {preview ? (
              <span className="text-sm">{contractStartDate || "未設定"}</span>
            ) : (
              <input
                type="date"
                value={contractStartDate}
                onChange={(e) => setContractStartDate(e.target.value)}
                className={fieldInput}
              />
            )}
          </Row>

          <Row label="契約期間">
            {preview ? (
              <span className="text-sm">
                {contractPeriodType === "INDEFINITE"
                  ? "無期"
                  : `有期（${contractStartDate}〜${contractEndDate || "未設定"}）`}
              </span>
            ) : (
              <div className="flex flex-col gap-2">
                <ToggleGroup
                  value={contractPeriodType}
                  onChange={setContractPeriodType}
                  options={[
                    { value: "INDEFINITE", label: "無期" },
                    { value: "FIXED_TERM", label: "有期" },
                  ]}
                />
                {contractPeriodType === "FIXED_TERM" ? (
                  <input
                    type="date"
                    value={contractEndDate}
                    onChange={(e) => setContractEndDate(e.target.value)}
                    className={fieldInput}
                  />
                ) : null}
              </div>
            )}
          </Row>

          <Row label="就業場所">
            {preview ? (
              <span className="text-sm">{workplaceNote || "自社"}</span>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  list="workplace-note-options"
                  value={workplaceNote}
                  onChange={(e) => setWorkplaceNote(e.target.value)}
                  placeholder="例：本社／〇〇支店／A社（空欄の場合は自社として扱われます）"
                  className={fieldInput}
                />
                <datalist id="workplace-note-options">
                  {clients.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
                <p className="text-xs text-muted">
                  自由入力です。実際の請求・給与計算は賃金単価・請求単価表とシフト作成時の配属先選択で行われます。
                </p>
              </div>
            )}
          </Row>

          <Row label="業務内容">
            {preview ? (
              <span className="text-sm">{jobDescription || "未設定"}</span>
            ) : (
              <input
                type="text"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="例：レストランホール接客"
                className={fieldInput}
              />
            )}
          </Row>

          <Row label="シフト">
            {preview ? (
              <span className="text-sm">
                {scheduleType === "FIXED"
                  ? `固定（${workingDayLabel || "未設定"}）`
                  : `シフト制${shiftPatternNote ? `（${shiftPatternNote}）` : ""}`}
              </span>
            ) : (
              <div className="flex flex-col gap-2">
                <ToggleGroup
                  value={scheduleType}
                  onChange={setScheduleType}
                  options={[
                    { value: "FIXED", label: "固定" },
                    { value: "SHIFT", label: "シフト制" },
                  ]}
                />
                {scheduleType === "FIXED" ? (
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => toggleWeekday(d.value)}
                        className={`h-8 w-8 rounded-lg border text-sm ${
                          fixedWeekdays.includes(d.value)
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "border-border text-muted"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={shiftPatternNote}
                    onChange={(e) => setShiftPatternNote(e.target.value)}
                    placeholder="例：4勤2休"
                    className={fieldInput}
                  />
                )}
              </div>
            )}
          </Row>

          <Row label="休み">
            {preview ? (
              <span className="text-sm">
                {scheduleType === "FIXED"
                  ? `${offDayLabel || "未設定"}${restNote ? `・${restNote}` : ""}`
                  : restNote || "未設定"}
              </span>
            ) : (
              <div className="flex flex-col gap-1">
                {scheduleType === "FIXED" ? (
                  <p className="text-sm">{offDayLabel || "勤務日を選択すると自動で表示されます"}</p>
                ) : null}
                <input
                  type="text"
                  value={restNote}
                  onChange={(e) => setRestNote(e.target.value)}
                  placeholder="例：祭日は休み／長期連休あり"
                  className={fieldInput}
                />
              </div>
            )}
          </Row>

          <Row label="所定の勤務時間">
            {preview ? (
              <span className="text-sm">
                {scheduleType === "FIXED"
                  ? `${workStartTime || "--:--"}〜${workEndTime || "--:--"}（実働${actualWorkHours}時間／休憩${breakMinutes}分）`
                  : "シフト制"}
              </span>
            ) : scheduleType === "FIXED" ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="time"
                  value={workStartTime}
                  onChange={(e) => setWorkStartTime(e.target.value)}
                  className={fieldInput}
                />
                〜
                <input
                  type="time"
                  value={workEndTime}
                  onChange={(e) => setWorkEndTime(e.target.value)}
                  className={fieldInput}
                />
                （実働
                <input
                  type="number"
                  value={actualWorkHours}
                  onChange={(e) => setActualWorkHours(e.target.value)}
                  className="w-14 rounded-lg border border-border px-2 py-1 text-sm"
                />
                時間／休憩
                <input
                  type="number"
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(e.target.value)}
                  className="w-14 rounded-lg border border-border px-2 py-1 text-sm"
                />
                分）
              </div>
            ) : (
              <span className="text-sm text-muted">シフト制（勤務ごとに異なります）</span>
            )}
          </Row>

          <Row label="残業の有無">
            {preview ? (
              <span className="text-sm">{hasOvertime ? `あり${overtimeNote ? `（${overtimeNote}）` : ""}` : "なし"}</span>
            ) : (
              <div className="flex flex-col gap-2">
                <ToggleGroup
                  value={hasOvertime}
                  onChange={setHasOvertime}
                  options={[
                    { value: true, label: "あり" },
                    { value: false, label: "なし" },
                  ]}
                />
                {hasOvertime ? (
                  <input
                    type="text"
                    value={overtimeNote}
                    onChange={(e) => setOvertimeNote(e.target.value)}
                    placeholder="例：月20時間まで"
                    className={fieldInput}
                  />
                ) : null}
              </div>
            )}
          </Row>

          <Row label="賃金">
            {preview ? (
              <span className="text-sm">
                {WAGE_TYPE_LABEL[wageType]} {wageAmount || "未設定"}円
              </span>
            ) : (
              <div className="flex gap-1">
                <select value={wageType} onChange={(e) => setWageType(e.target.value)} className={fieldInput}>
                  <option value="HOURLY">時給</option>
                  <option value="DAILY">日給</option>
                  <option value="MONTHLY">月給</option>
                </select>
                <input
                  type="number"
                  min="1"
                  value={wageAmount}
                  onChange={(e) => setWageAmount(e.target.value)}
                  placeholder="例：1450"
                  className="w-24 rounded-lg border border-border px-2 py-2 text-sm"
                />
                <span className="self-center text-muted">円</span>
              </div>
            )}
          </Row>

          <Row label="賃金の支払方法">
            {preview ? (
              <span className="text-sm">
                締め日 {paymentClosingDay || "未設定"}／支払日 {paymentDay || "未設定"}／{paymentMethod}
              </span>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={paymentClosingDay}
                    onChange={(e) => setPaymentClosingDay(e.target.value)}
                    placeholder="締め日（例：月末）"
                    className={`flex-1 ${fieldInput}`}
                  />
                  <input
                    type="text"
                    value={paymentDay}
                    onChange={(e) => setPaymentDay(e.target.value)}
                    placeholder="支払日（例：翌月25日）"
                    className={`flex-1 ${fieldInput}`}
                  />
                </div>
                <input type="text" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={fieldInput} />
              </div>
            )}
          </Row>

          {extraItems.map((item) => (
            <Row key={item.label} label={item.label}>
              {preview ? (
                <span className="text-sm">{item.value || "—"}</span>
              ) : (
                <div className="flex items-start gap-2">
                  <textarea
                    value={item.value}
                    onChange={(e) => updateChipValue(item.label, e.target.value)}
                    placeholder="内容（任意）"
                    rows={3}
                    className="min-w-0 flex-1 resize-y rounded-lg border border-border px-2 py-1.5 text-sm"
                  />
                  <button type="button" onClick={() => removeChip(item.label)} className="shrink-0 text-red-600">
                    ✕
                  </button>
                </div>
              )}
            </Row>
          ))}

          {!preview ? (
            <Row label="項目を追加">
              <div className="flex flex-col gap-2">
                {showCustomChipForm ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
                    <input
                      type="text"
                      value={customChipLabel}
                      onChange={(e) => setCustomChipLabel(e.target.value)}
                      placeholder="項目名"
                      className="w-full min-w-0 rounded-lg border border-border px-2 py-1.5 text-sm"
                    />
                    <textarea
                      value={customChipValue}
                      onChange={(e) => setCustomChipValue(e.target.value)}
                      placeholder="内容（任意）"
                      rows={2}
                      className="w-full min-w-0 resize-none rounded-lg border border-border px-2 py-1.5 text-sm"
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomChipForm(false);
                          setCustomChipLabel("");
                          setCustomChipValue("");
                        }}
                        className="text-sm text-muted"
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        disabled={!customChipLabel.trim()}
                        onClick={() => {
                          addChip(customChipLabel.trim(), customChipValue);
                          setCustomChipLabel("");
                          setCustomChipValue("");
                          setShowCustomChipForm(false);
                        }}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        追加
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {QUICK_ADD_CHIPS.map((label) => {
                    const added = extraItems.some((i) => i.label === label);
                    return (
                      <button
                        key={label}
                        type="button"
                        disabled={added}
                        onClick={() => addChip(label)}
                        className={`rounded-full border px-3 py-1 text-xs ${
                          added ? "border-border text-muted/50" : "border-border text-muted hover:border-primary"
                        }`}
                      >
                        ＋{label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setShowCustomChipForm(true)}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-primary"
                  >
                    ＋項目追加
                  </button>
                </div>
              </div>
            </Row>
          ) : null}
        </div>

        {consentForm ? (
          <div className="mt-6 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <p className="mb-3 text-sm font-semibold text-primary">
              以上の内容を確認しました。氏名・住所・電話番号を入力のうえ同意してください。
            </p>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span>
                  氏名<span className="text-red-600"> *</span>
                </span>
                <input
                  type="text"
                  value={consentName}
                  onChange={(e) => setConsentName(e.target.value)}
                  className={fieldInput}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span>
                  住所<span className="text-red-600"> *</span>
                </span>
                <input
                  type="text"
                  value={consentAddress}
                  onChange={(e) => setConsentAddress(e.target.value)}
                  className={fieldInput}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span>
                  電話番号<span className="text-red-600"> *</span>
                </span>
                <input
                  type="text"
                  value={consentPhoneNumber}
                  onChange={(e) => setConsentPhoneNumber(e.target.value)}
                  className={fieldInput}
                />
              </label>
            </div>
            {consentForm.error ? <p className="mt-2 text-xs text-red-600">{consentForm.error}</p> : null}
            <button
              type="button"
              disabled={
                consentForm.pending || !consentName.trim() || !consentAddress.trim() || !consentPhoneNumber.trim()
              }
              onClick={() =>
                consentForm.onConsent({
                  name: consentName.trim(),
                  address: consentAddress.trim(),
                  phoneNumber: consentPhoneNumber.trim(),
                })
              }
              className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              内容を確認しました（同意する）
            </button>
          </div>
        ) : null}

        {!readOnly ? (
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => setMode(preview ? "edit" : "preview")}
              className="flex-1 rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60"
            >
              {preview ? "内容を編集する" : "プレビュー"}
            </button>
            <button
              type="button"
              disabled={pending || !canSubmit}
              onClick={() =>
                startTransition(async () => {
                  const created = await submitTemplate();
                  if (created) onSaved?.(created);
                  onClose();
                })
              }
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {generateForStaff ? (
                "生成する"
              ) : editingTemplate && !duplicateAsNew ? (
                "更新する"
              ) : (
                <>
                  <span className="sm:hidden">テンプレ生成</span>
                  <span className="hidden sm:inline">テンプレートを生成</span>
                </>
              )}
            </button>
          </div>
        ) : null}
        {editingTemplate?.status === "LOCKED" && !generateForStaff && !duplicateAsNew && !readOnly ? (
          <p className="mt-2 text-xs text-muted">
            このテンプレートは契約中のスタッフがいるため、更新すると複製として新しく保存されます（元のテンプレートはそのまま残ります）。
          </p>
        ) : null}
      </div>
    </div>
  );
}

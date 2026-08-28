"use client";

import { useState, useTransition } from "react";
import { todayJst } from "@/lib/date";
import {
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
  generateStaffContractAction,
} from "@/app/company/contracts/actions";

export type Template = {
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

export type ClientOption = { id: string; name: string };

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

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
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{t.title}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
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
              <p className="text-xs text-muted">契約中: {t.contractedStaffNames.join("、")}</p>
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
      <span className="w-32 shrink-0 pt-2 text-xs font-semibold text-muted">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const fieldInput = "rounded-lg border border-border px-2 py-2 text-sm";

export function TemplateModal({
  clients,
  companyName,
  editingTemplate,
  generateForStaff,
  onClose,
  readOnly,
}: {
  clients: ClientOption[];
  companyName: string;
  editingTemplate?: Template;
  generateForStaff?: { userId: string; name: string };
  onClose: () => void;
  // 契約内容の閲覧専用（スタッフ詳細＞契約書管理の「詳細確認」）。常にプレビュー
  // 表示に固定し、編集・保存のボタンを出さない — 誤って共有テンプレートを
  // 書き換えてしまわないようにするため。
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [customTitle, setCustomTitle] = useState(
    generateForStaff && editingTemplate
      ? `${editingTemplate.title}（${generateForStaff.name}様）`
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

  const autoTitle = `${EMPLOYMENT_TYPE_LABEL[employmentType]}${jobDescription ? "・" + jobDescription : ""}`;
  const title = customTitle.trim() || autoTitle;
  const preview = mode === "preview";

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

  const canSubmit = Boolean(jobDescription) && Boolean(wageAmount);

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
    } else if (editingTemplate) {
      await updateTemplateAction(editingTemplate.id, payload);
    } else {
      await createTemplateAction(payload);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">
            {generateForStaff
              ? `契約書を生成${preview ? "" : "（" + generateForStaff.name + "様）"}`
              : `雇用契約書${preview ? "" : "テンプレート"}${editingTemplate && !preview ? "の編集" : ""}`}
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
          <p className="mb-3 text-xs text-muted">テンプレート名：{title}</p>
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
          {companyName}（以下「甲」）と{generateForStaff?.name ?? "（スタッフ名/自動反映）"}（以下「乙」）は、
          {contractStartDate || "開始日未設定"}
          より、以下の内容で雇用契約を締結する。
        </p>
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

          <Row label="その他項目">
            {preview ? (
              extraItems.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {extraItems.map((i) => (
                    <p key={i.label} className="text-sm">
                      <span className="font-semibold">{i.label}</span>
                      {i.value ? `：${i.value}` : ""}
                    </p>
                  ))}
                </div>
              ) : (
                <span className="text-sm">なし</span>
              )
            ) : (
              <div className="flex flex-col gap-2">
                {extraItems.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {extraItems.map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <span className="w-40 shrink-0 text-muted">{item.label}</span>
                        <input
                          type="text"
                          value={item.value}
                          onChange={(e) => updateChipValue(item.label, e.target.value)}
                          placeholder="内容（任意）"
                          className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm"
                        />
                        <button type="button" onClick={() => removeChip(item.label)} className="text-red-600">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {showCustomChipForm ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customChipLabel}
                      onChange={(e) => setCustomChipLabel(e.target.value)}
                      placeholder="項目名"
                      className="w-32 rounded-lg border border-border px-2 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      value={customChipValue}
                      onChange={(e) => setCustomChipValue(e.target.value)}
                      placeholder="内容（任意）"
                      className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm"
                    />
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
                    <button
                      type="button"
                      onClick={() => {
                        setShowCustomChipForm(false);
                        setCustomChipLabel("");
                        setCustomChipValue("");
                      }}
                      className="text-muted"
                    >
                      ✕
                    </button>
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
            )}
          </Row>
        </div>

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
                  await submitTemplate();
                  onClose();
                })
              }
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {generateForStaff ? "生成する" : editingTemplate ? "更新する" : "テンプレートを生成"}
            </button>
          </div>
        ) : null}
        {editingTemplate?.status === "LOCKED" && !generateForStaff && !readOnly ? (
          <p className="mt-2 text-xs text-muted">
            このテンプレートは契約中のスタッフがいるため、更新すると複製として新しく保存されます（元のテンプレートはそのまま残ります）。
          </p>
        ) : null}
      </div>
    </div>
  );
}

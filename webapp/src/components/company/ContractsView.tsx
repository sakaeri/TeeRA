"use client";

import { useState, useTransition } from "react";
import {
  createTemplateAction,
  deleteTemplateAction,
  upsertPlacementRateAction,
  deletePlacementRateAction,
} from "@/app/company/contracts/actions";

type Template = {
  id: string;
  title: string;
  employmentType: string;
  workplaceType: string;
  clientName: string | null;
  wageType: string;
  wageAmount: number;
  status: string;
  contractedStaffNames: string[];
};

type Rate = {
  id: string;
  clientName: string;
  companyRelationshipId: string | null;
  taskName: string;
  wageType: string;
  amount: number;
};

type ClientOption = { id: string; name: string };

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
  rates,
  clients,
  companyName,
}: {
  templates: Template[];
  rates: Rate[];
  clients: ClientOption[];
  companyName: string;
}) {
  return (
    <div className="flex flex-col gap-10">
      <PlacementRatesSection rates={rates} clients={clients} />
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

function PlacementRatesSection({ rates, clients }: { rates: Rate[]; clients: ClientOption[] }) {
  const [pending, startTransition] = useTransition();
  const [companyRelationshipId, setCompanyRelationshipId] = useState("");
  const [taskName, setTaskName] = useState("");
  const [wageType, setWageType] = useState("HOURLY");
  const [amount, setAmount] = useState("");

  return (
    <SectionCard title="賃金単価・請求単価">
      <table className="mb-4 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">配属先</th>
            <th className="py-2">業務内容</th>
            <th className="py-2">単価</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.id} className="border-b border-border/60">
              <td className="py-2">{r.clientName}</td>
              <td className="py-2">{r.taskName}</td>
              <td className="py-2">
                {WAGE_TYPE_LABEL[r.wageType]} {r.amount}円
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => deletePlacementRateAction(r.id))}
                  className="text-xs text-red-600 underline"
                >
                  削除
                </button>
              </td>
            </tr>
          ))}
          {rates.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-4 text-center text-muted">
                単価が登録されていません。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="flex flex-wrap items-end gap-2">
        <select
          value={companyRelationshipId}
          onChange={(e) => setCompanyRelationshipId(e.target.value)}
          className="rounded-lg border border-border px-2 py-2 text-sm"
        >
          <option value="">自社</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="業務内容"
          className="rounded-lg border border-border px-2 py-2 text-sm"
        />
        <select
          value={wageType}
          onChange={(e) => setWageType(e.target.value)}
          className="rounded-lg border border-border px-2 py-2 text-sm"
        >
          <option value="HOURLY">時給</option>
          <option value="DAILY">日給</option>
          <option value="MONTHLY">月給</option>
        </select>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="金額"
          className="w-28 rounded-lg border border-border px-2 py-2 text-sm"
        />
        <button
          type="button"
          disabled={pending || !taskName || !amount}
          onClick={() =>
            startTransition(async () => {
              await upsertPlacementRateAction({
                companyRelationshipId: companyRelationshipId || undefined,
                taskName,
                wageType: wageType as "HOURLY" | "DAILY" | "MONTHLY",
                amount: Number(amount),
              });
              setTaskName("");
              setAmount("");
            })
          }
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          ＋追加
        </button>
      </div>
    </SectionCard>
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
            {t.status !== "LOCKED" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => deleteTemplateAction(t.id))}
                className="mt-2 text-xs text-red-600 underline"
              >
                削除
              </button>
            ) : null}
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

function TemplateModal({
  clients,
  companyName,
  onClose,
}: {
  clients: ClientOption[];
  companyName: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [customTitle, setCustomTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("PART_TIME");
  const [workplaceType, setWorkplaceType] = useState<"INHOUSE" | "CLIENT">("INHOUSE");
  const [companyRelationshipId, setCompanyRelationshipId] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [contractPeriodType, setContractPeriodType] = useState<"INDEFINITE" | "FIXED_TERM">("INDEFINITE");
  const [contractStartDate, setContractStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [contractEndDate, setContractEndDate] = useState("");
  const [wageType, setWageType] = useState("HOURLY");
  const [wageAmount, setWageAmount] = useState("");
  const [scheduleType, setScheduleType] = useState<"FIXED" | "SHIFT">("SHIFT");
  const [workStartTime, setWorkStartTime] = useState("");
  const [workEndTime, setWorkEndTime] = useState("");
  const [actualWorkHours, setActualWorkHours] = useState("8");
  const [breakMinutes, setBreakMinutes] = useState("60");
  const [hasOvertime, setHasOvertime] = useState(false);
  const [overtimeNote, setOvertimeNote] = useState("");
  const [fixedWeekdays, setFixedWeekdays] = useState<number[]>([]);
  const [shiftPatternNote, setShiftPatternNote] = useState("");
  const [restNote, setRestNote] = useState("");
  const [paymentClosingDay, setPaymentClosingDay] = useState("");
  const [paymentDay, setPaymentDay] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("振込");
  const [extraItems, setExtraItems] = useState<{ label: string; value: string }[]>([]);
  const [customChipLabel, setCustomChipLabel] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const autoTitle = `${EMPLOYMENT_TYPE_LABEL[employmentType]}${jobDescription ? "・" + jobDescription : ""}`;
  const title = customTitle.trim() || autoTitle;

  const workingDayLabel = WEEKDAYS.filter((d) => fixedWeekdays.includes(d.value))
    .map((d) => d.label)
    .join("・");

  function toggleWeekday(v: number) {
    setFixedWeekdays((prev) => (prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v]));
  }

  function addChip(label: string) {
    if (extraItems.some((i) => i.label === label)) return;
    setExtraItems((prev) => [...prev, { label, value: "" }]);
  }

  function updateChipValue(label: string, value: string) {
    setExtraItems((prev) => prev.map((i) => (i.label === label ? { ...i, value } : i)));
  }

  function removeChip(label: string) {
    setExtraItems((prev) => prev.filter((i) => i.label !== label));
  }

  const canSubmit =
    Boolean(jobDescription) &&
    Boolean(wageAmount) &&
    (workplaceType === "INHOUSE" || Boolean(companyRelationshipId));

  function buildPreviewText() {
    const clientName = clients.find((c) => c.id === companyRelationshipId)?.name;
    const lines = [
      `${companyName}（以下「甲」）と（スタッフ名/自動反映）（以下「乙」）は、${contractStartDate || "開始日未設定"}より、以下の内容で雇用契約を締結する。`,
      "",
      `雇用主（甲）：${companyName}`,
      "従業員（乙）：（自動反映）",
      `雇用形態：${EMPLOYMENT_TYPE_LABEL[employmentType]}`,
      `就業場所：${workplaceType === "CLIENT" ? clientName ?? "配属先未選択" : "自社"}`,
      `業務内容：${jobDescription || "未入力"}`,
      `契約期間：${contractPeriodType === "INDEFINITE" ? "無期" : `有期（${contractStartDate}〜${contractEndDate || "未設定"}）`}`,
      `賃金：${WAGE_TYPE_LABEL[wageType]} ${wageAmount || "未入力"}円`,
      scheduleType === "FIXED"
        ? `所定の勤務時間：${workStartTime || "--:--"}〜${workEndTime || "--:--"}（実働${actualWorkHours}時間／休憩${breakMinutes}分）`
        : `所定の勤務時間：シフト制${shiftPatternNote ? `（${shiftPatternNote}）` : ""}`,
      `残業の有無：${hasOvertime ? `あり${overtimeNote ? `（${overtimeNote}）` : ""}` : "なし"}`,
      scheduleType === "FIXED"
        ? `勤務日：${workingDayLabel || "未選択"}／休み：${workingDayLabel ? `選択日以外（${workingDayLabel}）が休み` : "未設定"}${restNote ? `・${restNote}` : ""}`
        : `休み：${restNote || "未設定"}`,
      `賃金の支払方法：締め日 ${paymentClosingDay || "未設定"}／支払日 ${paymentDay || "未設定"}／${paymentMethod}`,
      ...(extraItems.length > 0 ? [`その他項目：${extraItems.map((i) => `${i.label}${i.value ? `（${i.value}）` : ""}`).join("、")}`] : []),
    ];
    return lines.join("\n");
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">雇用契約書テンプレート</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        <label className="mb-4 flex flex-col gap-1 text-xs">
          テンプレート名（管理用・スタッフには表示されません）
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder={`未入力の場合、自動生成されます（例：${autoTitle}）`}
            className="rounded-lg border border-border px-2 py-2 text-sm"
          />
        </label>

        {showPreview ? (
          <pre className="mb-4 whitespace-pre-wrap rounded-lg border border-accent bg-accent/10 p-3 text-xs">
            {buildPreviewText()}
          </pre>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            雇用形態
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            >
              {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            雇用開始日
            <input
              type="date"
              value={contractStartDate}
              onChange={(e) => setContractStartDate(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
          </label>

          <div className="col-span-2 flex flex-col gap-1 text-xs">
            契約期間
            <ToggleGroup
              value={contractPeriodType}
              onChange={setContractPeriodType}
              options={[
                { value: "INDEFINITE", label: "無期" },
                { value: "FIXED_TERM", label: "有期" },
              ]}
            />
          </div>
          {contractPeriodType === "FIXED_TERM" ? (
            <label className="col-span-2 flex flex-col gap-1 text-xs">
              契約終了日
              <input
                type="date"
                value={contractEndDate}
                onChange={(e) => setContractEndDate(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-xs">
            就業場所
            <select
              value={workplaceType}
              onChange={(e) => setWorkplaceType(e.target.value as "INHOUSE" | "CLIENT")}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            >
              <option value="INHOUSE">自社</option>
              <option value="CLIENT">配属先（派遣社員）</option>
            </select>
          </label>
          {workplaceType === "CLIENT" ? (
            <label className="flex flex-col gap-1 text-xs">
              配属先
              <select
                value={companyRelationshipId}
                onChange={(e) => setCompanyRelationshipId(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              >
                <option value="">選択してください</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-xs">
            賃金
            <div className="flex gap-1">
              <select
                value={wageType}
                onChange={(e) => setWageType(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              >
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
          </label>
          <label className="flex flex-col gap-1 text-xs">
            業務内容
            <input
              type="text"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="例：レストランホール接客"
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-1 text-xs">
          所定の勤務時間
          <ToggleGroup
            value={scheduleType}
            onChange={setScheduleType}
            options={[
              { value: "FIXED", label: "固定" },
              { value: "SHIFT", label: "シフト制" },
            ]}
          />
        </div>

        {scheduleType === "FIXED" ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <input
                type="time"
                value={workStartTime}
                onChange={(e) => setWorkStartTime(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
              〜
              <input
                type="time"
                value={workEndTime}
                onChange={(e) => setWorkEndTime(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
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
            <div className="mt-3 flex flex-col gap-1 text-xs">
              勤務日
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
            </div>
          </>
        ) : (
          <label className="mt-3 flex flex-col gap-1 text-xs">
            シフトパターン
            <input
              type="text"
              value={shiftPatternNote}
              onChange={(e) => setShiftPatternNote(e.target.value)}
              placeholder="例：4勤2休"
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
          </label>
        )}

        <div className="mt-4 flex flex-col gap-1 text-xs">
          残業の有無
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
              className="mt-2 rounded-lg border border-border px-2 py-2 text-sm"
            />
          ) : null}
        </div>

        <label className="mt-4 flex flex-col gap-1 text-xs">
          休み
          {scheduleType === "FIXED" ? (
            <p className="text-muted">
              {workingDayLabel ? `勤務日（${workingDayLabel}）以外が休みになります` : "勤務日を選択すると自動で表示されます"}
            </p>
          ) : null}
          <input
            type="text"
            value={restNote}
            onChange={(e) => setRestNote(e.target.value)}
            placeholder="例：祭日は休み／長期連休あり"
            className="rounded-lg border border-border px-2 py-2 text-sm"
          />
        </label>

        <div className="mt-4 flex flex-col gap-2 text-xs">
          賃金の支払方法
          <div className="flex gap-2">
            <input
              type="text"
              value={paymentClosingDay}
              onChange={(e) => setPaymentClosingDay(e.target.value)}
              placeholder="締め日（例：月末）"
              className="flex-1 rounded-lg border border-border px-2 py-2 text-sm"
            />
            <input
              type="text"
              value={paymentDay}
              onChange={(e) => setPaymentDay(e.target.value)}
              placeholder="支払日（例：翌月25日）"
              className="flex-1 rounded-lg border border-border px-2 py-2 text-sm"
            />
          </div>
          <input
            type="text"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="rounded-lg border border-border px-2 py-2 text-sm"
          />
        </div>

        <div className="mt-4 flex flex-col gap-2 text-xs">
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
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={customChipLabel}
                onChange={(e) => setCustomChipLabel(e.target.value)}
                placeholder="項目名"
                className="w-24 rounded-full border border-border px-3 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  if (!customChipLabel.trim()) return;
                  addChip(customChipLabel.trim());
                  setCustomChipLabel("");
                }}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-primary"
              >
                ＋項目追加
              </button>
            </div>
          </div>

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
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="flex-1 rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary"
          >
            プレビュー
          </button>
          <button
            type="button"
            disabled={pending || !canSubmit}
            onClick={() =>
              startTransition(async () => {
                await createTemplateAction({
                  title,
                  employmentType: employmentType as never,
                  workplaceType,
                  companyRelationshipId: workplaceType === "CLIENT" ? companyRelationshipId : undefined,
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
                    contractPeriodType === "FIXED_TERM" && contractEndDate
                      ? new Date(`${contractEndDate}T00:00:00.000Z`)
                      : undefined,
                  hasRenewal: false,
                  extraItems,
                });
                onClose();
              })
            }
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            テンプレートを生成
          </button>
        </div>
      </div>
    </div>
  );
}

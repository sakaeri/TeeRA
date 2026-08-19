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
}: {
  templates: Template[];
  rates: Rate[];
  clients: ClientOption[];
}) {
  return (
    <div className="flex flex-col gap-10">
      <PlacementRatesSection rates={rates} clients={clients} />
      <TemplatesSection templates={templates} clients={clients} />
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

function TemplatesSection({ templates, clients }: { templates: Template[]; clients: ClientOption[] }) {
  const [showForm, setShowForm] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <SectionCard title="雇用契約書テンプレート">
      <button
        type="button"
        onClick={() => setShowForm((v) => !v)}
        className="mb-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        {showForm ? "閉じる" : "＋テンプレートを作成"}
      </button>

      {showForm ? <TemplateForm clients={clients} onDone={() => setShowForm(false)} /> : null}

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

function TemplateForm({ clients, onDone }: { clients: ClientOption[]; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [employmentType, setEmploymentType] = useState("PART_TIME");
  const [workplaceType, setWorkplaceType] = useState<"INHOUSE" | "CLIENT">("INHOUSE");
  const [companyRelationshipId, setCompanyRelationshipId] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [wageType, setWageType] = useState("HOURLY");
  const [wageAmount, setWageAmount] = useState("");
  const [contractStartDate, setContractStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const title = `${EMPLOYMENT_TYPE_LABEL[employmentType]}${jobDescription ? "・" + jobDescription : ""}`;

  return (
    <div className="mb-6 rounded-xl border border-border p-4">
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
          <label className="col-span-2 flex flex-col gap-1 text-xs">
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
        <label className="col-span-2 flex flex-col gap-1 text-xs">
          業務内容
          <input
            type="text"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            className="rounded-lg border border-border px-2 py-2 text-sm"
          />
        </label>
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
              className="w-24 rounded-lg border border-border px-2 py-2 text-sm"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          契約開始日
          <input
            type="date"
            value={contractStartDate}
            onChange={(e) => setContractStartDate(e.target.value)}
            className="rounded-lg border border-border px-2 py-2 text-sm"
          />
        </label>
      </div>

      <p className="mt-3 text-xs text-muted">テンプレート名（自動）: {title}</p>

      <button
        type="button"
        disabled={pending || !jobDescription || !wageAmount}
        onClick={() =>
          startTransition(async () => {
            await createTemplateAction({
              title,
              employmentType: employmentType as never,
              workplaceType,
              companyRelationshipId: companyRelationshipId || undefined,
              jobDescription,
              scheduleType: "SHIFT",
              hasOvertime: false,
              fixedWeekdays: [],
              wageType: wageType as never,
              wageAmount: Number(wageAmount),
              contractPeriodType: "INDEFINITE",
              contractStartDate: new Date(`${contractStartDate}T00:00:00.000Z`),
              hasRenewal: false,
              extraItems: [],
            });
            onDone();
          })
        }
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        作成する
      </button>
    </div>
  );
}

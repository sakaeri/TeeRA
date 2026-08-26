"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  inviteStaffAction,
  createProxyStaffAction,
  addClientAction,
  addAgencyAction,
  inviteNewClientAction,
  inviteNewAgencyAction,
} from "@/app/company/actions";
import { StaffDetailPanel } from "@/components/company/StaffDetailPanel";
import { ClientDetailPanel } from "@/components/company/ClientDetailPanel";

type StaffRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  isProxy: boolean;
  teams: { teamId: string; teamName: string; role: string }[];
  monthlyHours: number;
  currentRateLabel: string;
  contractStatus: "確認済み" | "確認待ち" | "未送付";
};

const CONTRACT_STATUS_STYLE: Record<string, string> = {
  確認済み: "bg-emerald-100 text-emerald-800",
  確認待ち: "bg-amber-100 text-amber-800",
  未送付: "bg-rose-100 text-rose-800",
};

const PROXY_PROMPT_TITLE: Record<"client" | "agency" | "staff", string> = {
  staff: "スタッフの仮アカウントを作成",
  client: "依頼主の仮アカウントを作成",
  agency: "派遣会社の仮アカウントを作成",
};

type RelationshipRow = {
  id: string;
  name: string;
  isProxy: boolean;
  status: string;
};

type Team = { id: string; name: string };

type ContractTemplateOption = {
  id: string;
  title: string;
  employmentTypeLabel: string;
  wageLabel: string;
  workplaceName: string;
  contractStartDate: string;
};

type Tab = "staff" | "clients" | "agencies";

export function RosterView({
  staff,
  clients,
  agencies,
  teams,
  templates,
  agencyEnabled,
  dispatchEnabled,
}: {
  staff: StaffRow[];
  clients: RelationshipRow[];
  agencies: RelationshipRow[];
  teams: Team[];
  templates: ContractTemplateOption[];
  agencyEnabled: boolean;
  dispatchEnabled: boolean;
}) {
  const [tab, setTab] = useState<Tab>("staff");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [selectedRelationshipKind, setSelectedRelationshipKind] = useState<"client" | "agency" | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [showInviteStaffModal, setShowInviteStaffModal] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showInviteMenu, setShowInviteMenu] = useState(false);
  const [teamFilter, setTeamFilter] = useState("");
  const filteredStaff = teamFilter ? staff.filter((s) => s.teams.some((t) => t.teamId === teamFilter)) : staff;
  const [proxyNamePromptFor, setProxyNamePromptFor] = useState<
    "client" | "agency" | "staff" | null
  >(null);
  const [proxyNameInput, setProxyNameInput] = useState("");

  function openRelationship(id: string, kind: "client" | "agency") {
    setSelectedRelationshipId(id);
    setSelectedRelationshipKind(kind);
  }

  function copyToClipboard(url: string) {
    setInviteUrl(url);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  }

  function handleInviteStaff(contractTemplateId?: string) {
    startTransition(async () => {
      const url = await inviteStaffAction(undefined, contractTemplateId);
      copyToClipboard(url);
    });
  }

  function handleCreateProxy(kind: "client" | "agency" | "staff") {
    if (!proxyNameInput.trim()) return;
    startTransition(async () => {
      if (kind === "staff") {
        await createProxyStaffAction(proxyNameInput.trim());
      } else if (kind === "client") {
        await addClientAction(proxyNameInput.trim());
        setTab("clients");
      } else {
        await addAgencyAction(proxyNameInput.trim());
        setTab("agencies");
      }
      setProxyNamePromptFor(null);
      setProxyNameInput("");
    });
  }

  function handleInviteNewClient() {
    startTransition(async () => {
      const url = await inviteNewClientAction();
      copyToClipboard(url);
      setTab("clients");
    });
  }

  function handleInviteNewAgency() {
    startTransition(async () => {
      const url = await inviteNewAgencyAction();
      copyToClipboard(url);
      setTab("agencies");
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="font-serif-jp text-2xl font-bold">スタッフ名簿</h1>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm"
          >
            <option value="">全社（すべて表示）</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {tab === "staff" ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowInviteMenu((v) => !v)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              ＋スタッフを招待する
            </button>
            {showInviteMenu ? (
              <div className="absolute right-0 z-10 mt-2 w-48 rounded-lg border border-border bg-white shadow-md">
                <button
                  type="button"
                  disabled={pending}
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                  onClick={() => {
                    setShowInviteMenu(false);
                    setShowInviteStaffModal(true);
                  }}
                >
                  本アカウントを招待
                </button>
                <button
                  type="button"
                  className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                  onClick={() => {
                    setShowInviteMenu(false);
                    setProxyNamePromptFor("staff");
                  }}
                >
                  仮アカウントを作成
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mb-4 flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "staff"} onClick={() => setTab("staff")}>
          スタッフ一覧
        </TabButton>
        {agencyEnabled ? (
          <TabButton active={tab === "clients"} onClick={() => setTab("clients")}>
            依頼主一覧
          </TabButton>
        ) : null}
        {dispatchEnabled ? (
          <TabButton active={tab === "agencies"} onClick={() => setTab("agencies")}>
            派遣会社一覧
          </TabButton>
        ) : null}
        <div className="relative pb-2">
          <button
            type="button"
            onClick={() => setShowAddMenu((v) => !v)}
            className="px-3 py-2 text-sm text-muted hover:text-primary"
          >
            ＋ 取引先名簿を追加
          </button>
          {showAddMenu ? (
            <div className="absolute left-0 z-10 mt-2 w-64 rounded-lg border border-border bg-white shadow-md">
              <p
                className="px-4 pt-3 pb-1 text-xs font-semibold text-muted"
                title="スタッフの配属先の依頼主の名簿です。依頼主ごとに請求書を作成できます"
              >
                依頼主名簿
              </p>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                onClick={() => {
                  setShowAddMenu(false);
                  handleInviteNewClient();
                }}
              >
                本アカウントを招待
              </button>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                onClick={() => {
                  setShowAddMenu(false);
                  setProxyNamePromptFor("client");
                }}
              >
                仮アカウントを作成
              </button>
              <p
                className="border-t border-border px-4 pt-3 pb-1 text-xs font-semibold text-muted"
                title="自社にスタッフを派遣してくれている会社の名簿です"
              >
                派遣会社名簿
              </p>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                onClick={() => {
                  setShowAddMenu(false);
                  handleInviteNewAgency();
                }}
              >
                本アカウントを招待
              </button>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                onClick={() => {
                  setShowAddMenu(false);
                  setProxyNamePromptFor("agency");
                }}
              >
                仮アカウントを作成
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {inviteUrl ? (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm">
          <span className="truncate">招待URL: {inviteUrl}</span>
          <button
            type="button"
            onClick={() => setInviteUrl(null)}
            className="shrink-0 text-muted"
          >
            閉じる
          </button>
        </div>
      ) : null}

      {proxyNamePromptFor ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => {
            setProxyNamePromptFor(null);
            setProxyNameInput("");
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">
                {PROXY_PROMPT_TITLE[proxyNamePromptFor]}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setProxyNamePromptFor(null);
                  setProxyNameInput("");
                }}
                className="text-muted"
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={proxyNameInput}
              onChange={(e) => setProxyNameInput(e.target.value)}
              placeholder="名称を入力"
              className="mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={pending || !proxyNameInput.trim()}
              onClick={() => handleCreateProxy(proxyNamePromptFor)}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              作成
            </button>
          </div>
        </div>
      ) : null}

      {tab === "staff" ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background/60 text-left text-xs text-muted">
                <th className="px-4 py-3 font-semibold">氏名</th>
                <th className="px-4 py-3 font-semibold">今月稼働</th>
                <th className="px-4 py-3 font-semibold">現在の単価</th>
                <th className="px-4 py-3 font-semibold">チーム</th>
                <th className="px-4 py-3 font-semibold">契約書</th>
              </tr>
            </thead>
            <tbody>
              {filteredStaff.map((s) => (
                <tr
                  key={s.membershipId}
                  className="cursor-pointer border-b border-border/60 last:border-b-0 hover:bg-background/60"
                  onClick={() => setSelectedStaffId(s.userId)}
                >
                  <td className="px-4 py-3.5 font-medium">
                    {s.name}
                    {s.isProxy ? (
                      <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                        仮
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5 text-muted">{s.monthlyHours}h</td>
                  <td className="px-4 py-3.5 text-muted">{s.currentRateLabel}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {s.teams.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        s.teams.map((t) => (
                          <span
                            key={t.teamId}
                            className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900"
                          >
                            {t.teamName}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${CONTRACT_STATUS_STYLE[s.contractStatus]}`}>
                      {s.contractStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted">
                    スタッフが登録されていません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "clients" ? (
        <RelationshipTable rows={clients} onRowClick={(id) => openRelationship(id, "client")} />
      ) : null}

      {tab === "agencies" ? (
        <RelationshipTable rows={agencies} onRowClick={(id) => openRelationship(id, "agency")} />
      ) : null}

      {selectedStaffId ? (
        <StaffDetailPanel userId={selectedStaffId} onClose={() => setSelectedStaffId(null)} />
      ) : null}
      {selectedRelationshipId && selectedRelationshipKind ? (
        <ClientDetailPanel
          relationshipId={selectedRelationshipId}
          kind={selectedRelationshipKind}
          onClose={() => {
            setSelectedRelationshipId(null);
            setSelectedRelationshipKind(null);
          }}
        />
      ) : null}
      {showInviteStaffModal ? (
        <InviteStaffModal templates={templates} onClose={() => setShowInviteStaffModal(false)} />
      ) : null}
    </div>
  );
}

function InviteStaffModal({
  templates,
  onClose,
}: {
  templates: ContractTemplateOption[];
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const [contractStartDate, setContractStartDate] = useState("");
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const selectedTemplate = templates.find((t) => t.id === templateId);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">スタッフを招待する</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-muted">
          このURLを共有してください。1回のみ使用できます。URLを開いた方はログインまたは新規アカウント作成後、自動的に自社の直雇用スタッフとして追加されます。
        </p>

        {templates.length > 0 ? (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-muted">どのテンプレートで契約書を発行しますか？</label>
            <select
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                const t = templates.find((opt) => opt.id === e.target.value);
                setContractStartDate(t?.contractStartDate ?? "");
              }}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">選択しない</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            {selectedTemplate ? (
              <div className="mt-3 rounded-lg border border-border bg-background p-3 text-xs text-muted">
                <p>雇用形態: {selectedTemplate.employmentTypeLabel}</p>
                <p>賃金: {selectedTemplate.wageLabel}</p>
                <p>就業場所: {selectedTemplate.workplaceName}</p>
                <label className="mt-2 flex flex-col gap-1">
                  このスタッフの雇用開始日
                  <input
                    type="date"
                    value={contractStartDate}
                    onChange={(e) => setContractStartDate(e.target.value)}
                    className="rounded-lg border border-border px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-dashed border-border bg-background p-3 text-xs text-muted">
            契約書テンプレートがまだありません。先に作成すると、招待と同時に契約書も発行できます。
            <Link href="/company/settings?tab=contracts" target="_blank" className="ml-1 font-semibold text-primary underline">
              テンプレートを作成する →
            </Link>
          </div>
        )}

        {!url ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const generated = await inviteStaffAction(
                  undefined,
                  templateId || undefined,
                  templateId ? contractStartDate || undefined : undefined,
                );
                setUrl(generated);
              })
            }
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            招待URLを発行する
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={url}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm text-muted"
            />
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(url).catch(() => {});
                }
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              コピー
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-sm font-semibold ${
        active ? "border-accent text-primary" : "border-transparent text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function RelationshipTable({
  rows,
  onRowClick,
}: {
  rows: RelationshipRow[];
  onRowClick: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-background/60 text-left text-xs text-muted">
            <th className="px-4 py-3 font-semibold">名称</th>
            <th className="px-4 py-3 font-semibold">状態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b border-border/60 last:border-b-0 hover:bg-background/60"
              onClick={() => onRowClick(r.id)}
            >
              <td className="px-4 py-3.5">
                {r.name}
                {r.isProxy ? (
                  <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                    仮
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3.5 text-muted">{r.status === "ACTIVE" ? "有効" : "無効"}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={2} className="py-8 text-center text-muted">
                登録されていません。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

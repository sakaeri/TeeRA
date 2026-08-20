"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  inviteStaffAction,
  createProxyStaffAction,
  inviteProxyUpgradeAction,
  addClientAction,
  addAgencyAction,
  inviteClientUpgradeAction,
  inviteAgencyUpgradeAction,
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

  function handleUpgradeProxyStaff(userId: string) {
    startTransition(async () => {
      const url = await inviteProxyUpgradeAction(userId);
      copyToClipboard(url);
    });
  }

  function handleUpgradeRelationship(
    id: string,
    kind: "client" | "agency",
  ) {
    startTransition(async () => {
      const url =
        kind === "client"
          ? await inviteClientUpgradeAction(id)
          : await inviteAgencyUpgradeAction(id);
      copyToClipboard(url);
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
            <div className="absolute left-0 z-10 mt-2 w-44 rounded-lg border border-border bg-white shadow-md">
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                onClick={() => {
                  setShowAddMenu(false);
                  setProxyNamePromptFor("client");
                }}
              >
                依頼主名簿
              </button>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                onClick={() => {
                  setShowAddMenu(false);
                  setProxyNamePromptFor("agency");
                }}
              >
                派遣会社名簿
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
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-white p-4">
          <input
            type="text"
            autoFocus
            value={proxyNameInput}
            onChange={(e) => setProxyNameInput(e.target.value)}
            placeholder="名称を入力"
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => handleCreateProxy(proxyNamePromptFor)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            作成
          </button>
          <button
            type="button"
            onClick={() => {
              setProxyNamePromptFor(null);
              setProxyNameInput("");
            }}
            className="text-sm text-muted"
          >
            キャンセル
          </button>
        </div>
      ) : null}

      {tab === "staff" ? (
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2">氏名</th>
                <th className="py-2">今月稼働</th>
                <th className="py-2">現在の単価</th>
                <th className="py-2">チーム</th>
                <th className="py-2">契約書</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredStaff.map((s) => (
                <tr
                  key={s.membershipId}
                  className="cursor-pointer border-b border-border/60 hover:bg-background"
                  onClick={() => setSelectedStaffId(s.userId)}
                >
                  <td className="py-2 font-medium">
                    {s.name}
                    {s.isProxy ? (
                      <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                        仮
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 text-muted">{s.monthlyHours}h</td>
                  <td className="py-2 text-muted">{s.currentRateLabel}</td>
                  <td className="py-2">
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
                  <td className="py-2">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${CONTRACT_STATUS_STYLE[s.contractStatus]}`}>
                      {s.contractStatus}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {s.isProxy ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpgradeProxyStaff(s.userId);
                        }}
                        className="text-xs text-primary underline"
                      >
                        本アカウントと連携する→
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted">
                    スタッフが登録されていません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "clients" ? (
        <RelationshipTable
          rows={clients}
          onUpgrade={(id) => handleUpgradeRelationship(id, "client")}
          onRowClick={(id) => setSelectedRelationshipId(id)}
          pending={pending}
        />
      ) : null}

      {tab === "agencies" ? (
        <RelationshipTable
          rows={agencies}
          onUpgrade={(id) => handleUpgradeRelationship(id, "agency")}
          pending={pending}
        />
      ) : null}

      {teams.length > 0 ? (
        <p className="mt-8 text-xs text-muted">
          チーム: {teams.map((t) => t.name).join("、")}（チーム割り当ては設定タブから行えます）
        </p>
      ) : null}

      {selectedStaffId ? (
        <StaffDetailPanel userId={selectedStaffId} onClose={() => setSelectedStaffId(null)} />
      ) : null}
      {selectedRelationshipId ? (
        <ClientDetailPanel relationshipId={selectedRelationshipId} onClose={() => setSelectedRelationshipId(null)} />
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
  onUpgrade,
  onRowClick,
  pending,
}: {
  rows: RelationshipRow[];
  onUpgrade: (id: string) => void;
  onRowClick?: (id: string) => void;
  pending: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th className="py-2">名称</th>
          <th className="py-2">状態</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className={`border-b border-border/60 ${onRowClick ? "cursor-pointer hover:bg-background" : ""}`}
            onClick={() => onRowClick?.(r.id)}
          >
            <td className="py-2">
              {r.name}
              {r.isProxy ? (
                <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                  仮
                </span>
              ) : null}
            </td>
            <td className="py-2 text-muted">
              {r.status === "ACTIVE" ? "有効" : "無効"}
            </td>
            <td className="py-2 text-right">
              {r.isProxy ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpgrade(r.id);
                  }}
                  className="text-xs text-primary underline"
                >
                  招待する
                </button>
              ) : null}
            </td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={3} className="py-6 text-center text-muted">
              登録されていません。
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

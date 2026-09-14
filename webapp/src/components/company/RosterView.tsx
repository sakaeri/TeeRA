"use client";

import { useEffect, useState, useTransition } from "react";
import {
  inviteStaffAction,
  createProxyStaffAction,
  addClientAction,
  addAgencyAction,
  inviteNewClientAction,
  inviteNewAgencyAction,
  listPendingStaffInvitesAction,
  revokeStaffInviteAction,
} from "@/app/company/actions";
import { StaffDetailPanel } from "@/components/company/StaffDetailPanel";
import { ClientDetailPanel } from "@/components/company/ClientDetailPanel";
import { useClickOutside } from "@/lib/useClickOutside";
import { CopyUrlField } from "@/components/CopyUrlField";
import { TemplateModal, type Template, type ClientOption } from "@/components/company/ContractsView";
import { todayJst } from "@/lib/date";

type StaffRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  isProxy: boolean;
  teams: { teamId: string; teamName: string; role: string }[];
  monthlyHours: number;
  contractLabel: string;
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

const ADD_BUTTON_LABEL: Record<Tab, string> = {
  staff: "＋スタッフを追加する",
  clients: "＋依頼主を追加する",
  agencies: "＋派遣会社を追加する",
};

// 追加メニューの見出し（プロトタイプの「依頼主名簿 (i)」「派遣会社名簿 (i)」に対応）。
const ROSTER_LABEL: Partial<Record<Tab, string>> = {
  clients: "依頼主名簿",
  agencies: "派遣会社名簿",
};

// 見出し横の(i)アイコンをクリックすると出す説明文（プロトタイプのツールチップと同じ内容）。
const TAB_DESCRIPTION: Partial<Record<Tab, string>> = {
  clients: "スタッフの配属先の依頼主の名簿です。依頼主ごとに請求書を作成できます。",
  agencies: "自社にスタッフを派遣してくれている会社の名簿です。",
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
  companyName,
  clients,
  agencies,
  teams,
  templates,
  contractTemplates,
  knownTaskNames,
  initialStaffId,
  initialStaffTab,
  isCompanyScopeAdmin,
  myManagedTeams,
}: {
  staff: StaffRow[];
  companyName: string;
  clients: RelationshipRow[];
  agencies: RelationshipRow[];
  teams: Team[];
  templates: ContractTemplateOption[];
  contractTemplates: Template[];
  knownTaskNames: string[];
  initialStaffId?: string;
  initialStaffTab?: "contracts";
  isCompanyScopeAdmin: boolean;
  myManagedTeams: Team[];
}) {
  const [tab, setTab] = useState<Tab>("staff");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(initialStaffId ?? null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [selectedRelationshipKind, setSelectedRelationshipKind] = useState<"client" | "agency" | null>(null);
  const [showInviteStaffModal, setShowInviteStaffModal] = useState(false);
  const [showInviteRelationshipModal, setShowInviteRelationshipModal] = useState<"client" | "agency" | null>(null);
  const [pending, startTransition] = useTransition();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showAddMenuInfo, setShowAddMenuInfo] = useState(false);
  const [teamFilter, setTeamFilter] = useState("");
  const filteredStaff = teamFilter ? staff.filter((s) => s.teams.some((t) => t.teamId === teamFilter)) : staff;
  const [proxyNamePromptFor, setProxyNamePromptFor] = useState<
    "client" | "agency" | "staff" | null
  >(null);
  const [proxyNameInput, setProxyNameInput] = useState("");
  const [proxyTeamId, setProxyTeamId] = useState("");
  const addMenuRef = useClickOutside<HTMLDivElement>(showAddMenu, () => setShowAddMenu(false));

  // 依頼主/派遣会社は会社全体の資産なのでチームスコープの概念が無く、
  // 本部管理者/編集者だけが追加できる。スタッフは自チーム内であれば
  // マネージャーも追加できる（canManage(membership, teamId)と対応）。
  const canAddStaff = isCompanyScopeAdmin || myManagedTeams.length > 0;
  const canAddClientsOrAgencies = isCompanyScopeAdmin;
  const canShowAddButton = tab === "staff" ? canAddStaff : canAddClientsOrAgencies;
  // マネージャーが複数チームを管理している場合だけ選ばせる — 1つだけなら
  // 自動的にそのチーム宛にする。本部管理者/編集者はチーム未指定のまま
  // （今まで通りの挙動）。
  const proxyStaffTeamId = isCompanyScopeAdmin
    ? undefined
    : myManagedTeams.length === 1
      ? myManagedTeams[0].id
      : proxyTeamId || undefined;
  const needsProxyTeamChoice = !isCompanyScopeAdmin && myManagedTeams.length > 1;

  function openRelationship(id: string, kind: "client" | "agency") {
    setSelectedRelationshipId(id);
    setSelectedRelationshipKind(kind);
  }

  function handleCreateProxy(kind: "client" | "agency" | "staff") {
    if (!proxyNameInput.trim()) return;
    if (kind === "staff" && needsProxyTeamChoice && !proxyTeamId) return;
    startTransition(async () => {
      if (kind === "staff") {
        await createProxyStaffAction(proxyNameInput.trim(), proxyStaffTeamId);
      } else if (kind === "client") {
        await addClientAction(proxyNameInput.trim());
        setTab("clients");
      } else {
        await addAgencyAction(proxyNameInput.trim());
        setTab("agencies");
      }
      setProxyTeamId("");
      setProxyNamePromptFor(null);
      setProxyNameInput("");
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="font-serif-jp text-2xl font-bold">スタッフ名簿</h1>
          {tab === "staff" ? (
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
          ) : null}
        </div>

        {canShowAddButton ? (
        <div className="relative" ref={addMenuRef}>
          <button
            type="button"
            onClick={() => {
              setShowAddMenu((v) => !v);
              setShowAddMenuInfo(false);
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {ADD_BUTTON_LABEL[tab]}
          </button>
          {showAddMenu ? (
            <div className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-border bg-white shadow-md">
              {ROSTER_LABEL[tab] ? (
                <div className="border-b border-border px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-muted">{ROSTER_LABEL[tab]}</span>
                    <button
                      type="button"
                      onClick={() => setShowAddMenuInfo((v) => !v)}
                      aria-label="説明を見る"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted"
                    >
                      i
                    </button>
                  </div>
                  {showAddMenuInfo ? (
                    <p className="mt-1.5 text-xs text-muted">{TAB_DESCRIPTION[tab]}</p>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                disabled={pending}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                onClick={() => {
                  setShowAddMenu(false);
                  if (tab === "staff") setShowInviteStaffModal(true);
                  else setShowInviteRelationshipModal(tab === "clients" ? "client" : "agency");
                }}
              >
                本アカウントを招待
              </button>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm hover:bg-background"
                onClick={() => {
                  setShowAddMenu(false);
                  setProxyNamePromptFor(tab === "staff" ? "staff" : tab === "clients" ? "client" : "agency");
                }}
              >
                仮アカウントを作成
              </button>
            </div>
          ) : null}
        </div>
        ) : null}
      </div>

      <div className="mb-1 flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "staff"} onClick={() => setTab("staff")}>
          スタッフ一覧
        </TabButton>
        <TabButton active={tab === "clients"} onClick={() => setTab("clients")}>
          依頼主一覧
        </TabButton>
        <TabButton active={tab === "agencies"} onClick={() => setTab("agencies")}>
          派遣会社一覧
        </TabButton>
      </div>

      <div className="mb-4" />

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
            {proxyNamePromptFor === "staff" && needsProxyTeamChoice ? (
              <div className="mb-4">
                <label className="mb-1 block text-xs text-muted">どのチームに追加しますか？</label>
                <select
                  value={proxyTeamId}
                  onChange={(e) => setProxyTeamId(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="">選択してください</option>
                  {myManagedTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <button
              type="button"
              disabled={
                pending ||
                !proxyNameInput.trim() ||
                (proxyNamePromptFor === "staff" && needsProxyTeamChoice && !proxyTeamId)
              }
              onClick={() => handleCreateProxy(proxyNamePromptFor)}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              作成
            </button>
          </div>
        </div>
      ) : null}

      {tab === "staff" ? (
        <div className="hidden overflow-hidden rounded-xl border border-border sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background/60 text-left text-xs text-muted">
                <th className="px-4 py-3 font-semibold">氏名</th>
                <th className="px-4 py-3 font-semibold">今月稼働</th>
                <th className="px-4 py-3 font-semibold">契約内容</th>
                <th className="px-4 py-3 font-semibold">チーム</th>
                <th className="px-4 py-3 font-semibold">契約書</th>
              </tr>
            </thead>
            <tbody className="bg-white">
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
                  <td className="px-4 py-3.5 text-muted">{s.contractLabel}</td>
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

      {tab === "staff" ? (
        <div className="flex flex-col gap-2 sm:hidden">
          {filteredStaff.map((s) => (
            <button
              key={s.membershipId}
              type="button"
              onClick={() => setSelectedStaffId(s.userId)}
              className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-white p-3 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {s.name}
                  {s.isProxy ? (
                    <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">仮</span>
                  ) : null}
                </span>
                <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${CONTRACT_STATUS_STYLE[s.contractStatus]}`}>
                  {s.contractStatus}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>今月稼働 {s.monthlyHours}h</span>
                <span>{s.contractLabel}</span>
              </div>
              {s.teams.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {s.teams.map((t) => (
                    <span key={t.teamId} className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900">
                      {t.teamName}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          ))}
          {filteredStaff.length === 0 ? <p className="py-8 text-center text-muted">スタッフが登録されていません。</p> : null}
        </div>
      ) : null}

      {tab === "clients" ? (
        <RelationshipTable rows={clients} onRowClick={(id) => openRelationship(id, "client")} />
      ) : null}

      {tab === "agencies" ? (
        <RelationshipTable rows={agencies} onRowClick={(id) => openRelationship(id, "agency")} />
      ) : null}

      {selectedStaffId ? (
        <StaffDetailPanel
          userId={selectedStaffId}
          companyName={companyName}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          contractTemplates={contractTemplates}
          knownTaskNames={knownTaskNames}
          allTeams={teams}
          initialTab={selectedStaffId === initialStaffId ? initialStaffTab : undefined}
          onClose={() => setSelectedStaffId(null)}
        />
      ) : null}
      {selectedRelationshipId && selectedRelationshipKind ? (
        <ClientDetailPanel
          relationshipId={selectedRelationshipId}
          kind={selectedRelationshipKind}
          knownTaskNames={knownTaskNames}
          allTeams={teams}
          onClose={() => {
            setSelectedRelationshipId(null);
            setSelectedRelationshipKind(null);
          }}
        />
      ) : null}
      {showInviteStaffModal ? (
        <InviteStaffModal
          templates={templates}
          contractTemplates={contractTemplates}
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          companyName={companyName}
          isCompanyScopeAdmin={isCompanyScopeAdmin}
          myManagedTeams={myManagedTeams}
          onClose={() => setShowInviteStaffModal(false)}
        />
      ) : null}
      {showInviteRelationshipModal ? (
        <InviteRelationshipModal kind={showInviteRelationshipModal} onClose={() => setShowInviteRelationshipModal(null)} />
      ) : null}
    </div>
  );
}

function InviteStaffModal({
  templates,
  contractTemplates,
  clients,
  companyName,
  isCompanyScopeAdmin,
  myManagedTeams,
  onClose,
}: {
  templates: ContractTemplateOption[];
  contractTemplates: Template[];
  clients: ClientOption[];
  companyName: string;
  isCompanyScopeAdmin: boolean;
  myManagedTeams: Team[];
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const [contractStartDate, setContractStartDate] = useState("");
  const [teamId, setTeamId] = useState("");
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [templateModalMode, setTemplateModalMode] = useState<"new" | "duplicate" | null>(null);
  const [pendingInvites, setPendingInvites] = useState<{ id: string; url: string; createdAt: string }[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const selectedTemplate = templates.find((t) => t.id === templateId);
  const selectedFullTemplate = contractTemplates.find((t) => t.id === templateId);
  const needsTeamChoice = !isCompanyScopeAdmin && myManagedTeams.length > 1;

  useEffect(() => {
    listPendingStaffInvitesAction().then(setPendingInvites);
  }, [url]);

  function revoke(inviteId: string) {
    setRevokingId(inviteId);
    startTransition(async () => {
      await revokeStaffInviteAction(inviteId);
      setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
      setRevokingId(null);
    });
  }
  const effectiveTeamId = isCompanyScopeAdmin
    ? undefined
    : myManagedTeams.length === 1
      ? myManagedTeams[0].id
      : teamId || undefined;

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

        {needsTeamChoice ? (
          <div className="mb-4">
            <label className="mb-1 block text-xs text-muted">どのチームに追加しますか？</label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">選択してください</option>
              {myManagedTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

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
            <div className="mt-2 flex gap-3 text-xs">
              <button
                type="button"
                onClick={() => setTemplateModalMode("new")}
                className="font-semibold text-primary underline"
              >
                ＋ 新規テンプレートを作成する
              </button>
              {selectedFullTemplate ? (
                <button
                  type="button"
                  onClick={() => setTemplateModalMode("duplicate")}
                  className="font-semibold text-primary underline"
                >
                  このテンプレートを複製して新規作成
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-dashed border-border bg-background p-3 text-xs text-muted">
            契約書テンプレートがまだありません。
            <button
              type="button"
              onClick={() => setTemplateModalMode("new")}
              className="ml-1 font-semibold text-primary underline"
            >
              ＋ 新規テンプレートを作成する
            </button>
          </div>
        )}

        {templateModalMode ? (
          <TemplateModal
            clients={clients}
            companyName={companyName}
            editingTemplate={templateModalMode === "duplicate" ? selectedFullTemplate : undefined}
            duplicateAsNew={templateModalMode === "duplicate"}
            onSaved={(created) => {
              setTemplateId(created.id);
              setContractStartDate(todayJst());
            }}
            onClose={() => setTemplateModalMode(null)}
          />
        ) : null}

        {!url ? (
          <button
            type="button"
            disabled={pending || (needsTeamChoice && !teamId)}
            onClick={() =>
              startTransition(async () => {
                const generated = await inviteStaffAction(
                  effectiveTeamId,
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
          <CopyUrlField url={url} />
        )}

        {pendingInvites.length > 0 ? (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold text-muted">
              発行済み・未使用の招待URL（{pendingInvites.length}件）
            </p>
            <ul className="flex flex-col gap-1.5">
              {pendingInvites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-xs"
                >
                  <span className="text-muted">
                    {new Date(invite.createdAt).toLocaleDateString("ja-JP")}発行
                  </span>
                  <button
                    type="button"
                    disabled={pending && revokingId === invite.id}
                    onClick={() => revoke(invite.id)}
                    className="shrink-0 text-red-600 hover:underline disabled:opacity-60"
                  >
                    無効化する
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// 依頼主/派遣会社を「本アカウントを招待」で追加する場合のポップアップ。
// URLを発行しただけではまだ何も名簿には追加されない — 相手が招待を開いて
// 自社として受け取るボタンを押した時点で、初めて名簿にその会社が現れる。
function InviteRelationshipModal({
  kind,
  onClose,
}: {
  kind: "client" | "agency";
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">
            {kind === "client" ? "依頼主を招待する" : "派遣会社を招待する"}
          </h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-muted">
          このURLを共有してください。1回のみ使用できます。URLを開いた会社が「この会社として招待を受け取る」を押すと、
          {kind === "client" ? "依頼主として" : "派遣会社として"}この名簿に追加されます。
        </p>

        {!url ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const generated = kind === "client" ? await inviteNewClientAction() : await inviteNewAgencyAction();
                setUrl(generated);
              })
            }
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            招待URLを発行する
          </button>
        ) : (
          <CopyUrlField url={url} />
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
      <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border bg-background/60 text-left text-xs text-muted">
            <th className="px-4 py-3 font-semibold">名称</th>
            <th className="px-4 py-3 font-semibold">状態</th>
          </tr>
        </thead>
        <tbody className="bg-white">
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
    </div>
  );
}

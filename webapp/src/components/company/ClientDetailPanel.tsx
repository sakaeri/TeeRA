"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getClientMonthDetailAction,
  addRelationshipNoteAction,
  deleteRelationshipNoteAction,
  inviteClientUpgradeAction,
  inviteAgencyUpgradeAction,
  setClientTeamsAction,
  deleteCompanyRelationshipAction,
  unplaceStaffAction,
} from "@/app/company/actions";
import { addPlacementRateVersionAction, deletePlacementTaskNameAction } from "@/app/company/contracts/actions";
import { todayJstParts, todayJst } from "@/lib/date";
import { CopyUrlField } from "@/components/CopyUrlField";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type PlacementRate = {
  id: string;
  taskName: string;
  currentLabel: string;
  versions: { id: string; label: string; effectiveFrom: string }[];
};

type RelationshipNote = {
  id: string;
  content: string;
  authorName: string;
  createdAt: string;
};

type Placement = {
  staffUserId: string;
  staffName: string;
  active: boolean;
  startedAt: string;
  endedAt: string | null;
};

type ClientMonthDetail = {
  relationshipId: string;
  name: string;
  isProxy: boolean;
  teams: { teamId: string; teamName: string }[];
  placements: Placement[];
  relationshipNotes: RelationshipNote[];
  workedHours: number;
  unapprovedCount: number;
  placementRates: PlacementRate[];
  days: {
    shiftId: string;
    date: string;
    staffName: string;
    startTime: string | null;
    endTime: string | null;
    isAllDay: boolean;
    isUndecided: boolean;
    approvalStatus: string | null;
    taskName: string | null;
  }[];
};

const APPROVAL_PILL: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-sky-100 text-sky-800",
  REJECTED: "bg-rose-100 text-rose-800",
};
const APPROVAL_LABEL: Record<string, string> = {
  PENDING: "未承認",
  APPROVED: "承認済み",
  REJECTED: "差戻し",
};

function timeLabel(d: ClientMonthDetail["days"][number]) {
  if (!d.approvalStatus) return "未提出";
  if (d.isUndecided) return "未定";
  if (d.isAllDay) return "終日";
  return `${d.startTime ?? "--:--"}〜${d.endTime ?? "--:--"}`;
}

export function ClientDetailPanel({
  relationshipId,
  kind,
  knownTaskNames,
  allTeams,
  onClose,
}: {
  relationshipId: string;
  kind: "client" | "agency";
  knownTaskNames: string[];
  allTeams: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const initToday = todayJstParts();
  const [year, setYear] = useState(initToday.year);
  const [month, setMonth] = useState(initToday.month);
  const [tab, setTab] = useState<"history" | "staff" | "rates" | "note">("history");
  const [data, setData] = useState<ClientMonthDetail | null>(null);
  const [pending, startTransition] = useTransition();
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [deleteNoteConfirmTarget, setDeleteNoteConfirmTarget] = useState<RelationshipNote | null>(null);
  const [editingTeams, setEditingTeams] = useState(false);
  const [teamSelection, setTeamSelection] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showPlacementHistory, setShowPlacementHistory] = useState(false);
  const [unplaceConfirmTarget, setUnplaceConfirmTarget] = useState<Placement | null>(null);

  function submitUnplace() {
    const target = unplaceConfirmTarget;
    if (!target) return;
    setUnplaceConfirmTarget(null);
    startTransition(async () => {
      await unplaceStaffAction(relationshipId, target.staffUserId);
      await refresh();
    });
  }

  function handleUpgrade() {
    startTransition(async () => {
      const url = kind === "client" ? await inviteClientUpgradeAction(relationshipId) : await inviteAgencyUpgradeAction(relationshipId);
      setUpgradeUrl(url);
    });
  }

  function submitDeleteRelationship() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteCompanyRelationshipAction(relationshipId);
      if (result?.error) {
        setDeleteError(
          result.error === "has_activity"
            ? "稼働実績があるため削除できません。"
            : "削除できませんでした。",
        );
        setShowDeleteConfirm(false);
        return;
      }
      setShowDeleteConfirm(false);
      onClose();
      router.refresh();
    });
  }

  function refresh() {
    return getClientMonthDetailAction(relationshipId, year, month).then((d) => {
      setData(d);
    });
  }

  function startEditTeams(teams: ClientMonthDetail["teams"]) {
    setTeamSelection(new Set(teams.map((t) => t.teamId)));
    setEditingTeams(true);
  }

  function submitTeams() {
    startTransition(async () => {
      await setClientTeamsAction(relationshipId, Array.from(teamSelection));
      setEditingTeams(false);
      await refresh();
    });
  }

  useEffect(() => {
    let cancelled = false;
    getClientMonthDetailAction(relationshipId, year, month).then((d) => {
      if (cancelled) return;
      setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [relationshipId, year, month]);

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="mb-2 self-start text-sm text-muted">
          ← 閉じる
        </button>

        {!data ? (
          <p className="text-sm text-muted">読み込み中…</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif-jp text-xl font-bold">{data.name}</h2>
              {data.isProxy ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-xs text-muted hover:text-red-600"
                >
                  取引先情報を削除
                </button>
              ) : null}
            </div>

            {deleteError ? <p className="mb-3 text-xs text-red-600">{deleteError}</p> : null}

            {data.isProxy ? (
              <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs">
                {upgradeUrl ? (
                  <CopyUrlField url={upgradeUrl} size="sm" />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span>仮アカウントです。招待URLを送って本アカウントと連携できます。</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={handleUpgrade}
                      className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      本アカウントと連携する
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {kind === "client" ? (
              !editingTeams ? (
                <div className="mb-4 flex flex-wrap items-center gap-1">
                  {data.teams.length === 0 ? (
                    <span className="text-xs text-muted">紐づくチームなし</span>
                  ) : (
                    data.teams.map((t) => (
                      <span key={t.teamId} className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900">
                        {t.teamName}
                      </span>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => startEditTeams(data.teams)}
                    aria-label="チームとの紐付けを編集"
                    className="ml-1 text-xs text-muted hover:text-primary"
                  >
                    <span className="inline-block scale-x-[-1]">✎</span> 編集
                  </button>
                </div>
              ) : (
                <div className="mb-4 rounded-lg border border-border bg-background/40 p-3">
                  <p className="mb-1 text-xs font-medium">紐づくチーム（複数選択可・シフト作成時に上に出す依頼主）</p>
                  <div className="mb-3 flex flex-col gap-1">
                    {allTeams.map((team) => (
                      <label key={team.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={teamSelection.has(team.id)}
                          disabled={pending}
                          onChange={(e) =>
                            setTeamSelection((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(team.id);
                              else next.delete(team.id);
                              return next;
                            })
                          }
                        />
                        {team.name}
                      </label>
                    ))}
                    {allTeams.length === 0 ? <p className="text-xs text-muted">チームがまだありません。</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={submitTeams}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingTeams(false)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              )
            ) : null}

            <div className="mb-4 flex gap-4 border-b border-border text-sm">
              <button
                type="button"
                onClick={() => setTab("history")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "history" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                稼働履歴
              </button>
              <button
                type="button"
                onClick={() => setTab("staff")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "staff" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                スタッフ一覧
              </button>
              {kind === "client" ? (
                <button
                  type="button"
                  onClick={() => setTab("rates")}
                  className={`border-b-2 px-1 py-2 font-semibold ${tab === "rates" ? "border-accent text-primary" : "border-transparent text-muted"}`}
                >
                  単価
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setTab("note")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "note" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                情報メモ
              </button>
            </div>

            {tab === "history" ? (
              <div>
                <div className="mb-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    aria-label="前の月"
                    className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                      <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <span className="font-serif-jp text-lg font-bold">
                    {year}年{month}月
                  </span>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    aria-label="次の月"
                    className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                      <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                <div className={`mb-4 grid gap-2 text-center ${kind === "client" ? "grid-cols-3" : "grid-cols-2"}`}>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted">稼働時間</p>
                    <p className="text-lg font-bold">{data.workedHours}時間</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted">未承認数</p>
                    <p className="text-lg font-bold text-rose-600">{data.unapprovedCount}件</p>
                  </div>
                  {kind === "client" ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-border p-3">
                      <p className="mb-1 text-xs text-muted">請求明細</p>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(`/company/invoices?month=${year}-${String(month).padStart(2, "0")}&client=${relationshipId}`)
                        }
                        className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                      >
                        作成する
                      </button>
                    </div>
                  ) : null}
                </div>

                <ul className="flex flex-col gap-1">
                  {data.days.map((d) => (
                    <li key={d.shiftId} className="flex items-center justify-between border-b border-border/50 py-2 text-sm">
                      <span>
                        {d.date}
                        {d.taskName ? <span className="ml-1.5 text-xs text-muted">（{d.taskName}）</span> : null}
                      </span>
                      <span>{d.staffName}</span>
                      <span className="text-muted">{timeLabel(d)}</span>
                      {d.approvalStatus ? (
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${APPROVAL_PILL[d.approvalStatus]}`}>
                          {APPROVAL_LABEL[d.approvalStatus]}
                        </span>
                      ) : (
                        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">未提出</span>
                      )}
                    </li>
                  ))}
                  {data.days.length === 0 ? <p className="py-6 text-center text-sm text-muted">この月のシフトはありません。</p> : null}
                </ul>
              </div>
            ) : null}

            {tab === "staff" ? (
              <div>
                <p className="mb-2 text-xs font-medium text-muted">配属中スタッフ</p>
                <ul className="flex flex-col gap-2">
                  {data.placements
                    .filter((p) => p.active)
                    .map((p) => (
                      <li key={p.staffUserId} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                        <span>
                          {p.staffName}
                          <span className="ml-1 text-xs text-muted">（{p.startedAt}〜）</span>
                        </span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setUnplaceConfirmTarget(p)}
                          className="shrink-0 text-xs text-muted hover:text-red-600"
                        >
                          配属解除
                        </button>
                      </li>
                    ))}
                  {data.placements.filter((p) => p.active).length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted">配属中のスタッフはいません。</p>
                  ) : null}
                </ul>
                {data.placements.some((p) => !p.active) ? (
                  <button
                    type="button"
                    onClick={() => setShowPlacementHistory((v) => !v)}
                    className="mt-2 text-xs text-muted hover:text-primary"
                  >
                    {showPlacementHistory ? "解除履歴を隠す" : "解除履歴を表示"}
                  </button>
                ) : null}
                {showPlacementHistory ? (
                  <ul className="mt-2 flex flex-col gap-2">
                    {data.placements
                      .filter((p) => !p.active)
                      .map((p) => (
                        <li key={`${p.staffUserId}-${p.endedAt}`} className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted">
                          {p.staffName}（{p.startedAt}〜{p.endedAt}・配属解除）
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {tab === "rates" ? (
              <PlacementRatesTab
                relationshipId={relationshipId}
                rates={data.placementRates}
                knownTaskNames={knownTaskNames}
                onChanged={refresh}
              />
            ) : null}

            {tab === "note" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setShowNoteForm(true)}
                    className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    ＋メモ作成
                  </button>
                </div>
                <ul className="flex flex-col gap-2">
                  {data.relationshipNotes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-border p-3 text-sm">
                      <p className="whitespace-pre-wrap">{n.content}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted">
                        <span>
                          {n.createdAt} {n.authorName}
                        </span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setDeleteNoteConfirmTarget(n)}
                          aria-label="削除"
                          className="hover:text-red-600 disabled:opacity-60"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                  {data.relationshipNotes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted">メモはまだありません。</p>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>

      {showDeleteConfirm ? (
        <ConfirmDialog
          message="この取引先情報を削除します。元に戻せません。よろしいですか？"
          confirmLabel="削除する"
          pending={pending}
          onConfirm={submitDeleteRelationship}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      ) : null}

      {unplaceConfirmTarget ? (
        <ConfirmDialog
          message={`${unplaceConfirmTarget.staffName}さんの配属を解除します。以後オーダーへの応募はできなくなります（シフト作成やオーダーへのアサインで再配属できます）。よろしいですか？`}
          confirmLabel="配属解除する"
          pending={pending}
          onConfirm={submitUnplace}
          onCancel={() => setUnplaceConfirmTarget(null)}
        />
      ) : null}

      {deleteNoteConfirmTarget ? (
        <ConfirmDialog
          message="このメモを削除します。よろしいですか？"
          confirmLabel="削除する"
          pending={pending}
          onConfirm={() => {
            const target = deleteNoteConfirmTarget;
            startTransition(async () => {
              await deleteRelationshipNoteAction(target.id);
              await refresh();
            });
            setDeleteNoteConfirmTarget(null);
          }}
          onCancel={() => setDeleteNoteConfirmTarget(null)}
        />
      ) : null}

      {showNoteForm && data ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowNoteForm(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">メモを作成</h4>
              <button type="button" onClick={() => setShowNoteForm(false)} aria-label="閉じる" className="text-muted hover:text-primary">
                ✕
              </button>
            </div>
            <textarea
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              rows={5}
              placeholder="この取引先に関するメモを入力"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground"
            />
            <button
              type="button"
              disabled={pending || !newNoteContent.trim()}
              onClick={() =>
                startTransition(async () => {
                  await addRelationshipNoteAction(data.relationshipId, newNoteContent);
                  setNewNoteContent("");
                  setShowNoteForm(false);
                  await refresh();
                })
              }
              className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              作成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const WAGE_TYPE_OPTIONS: { value: "HOURLY" | "DAILY" | "MONTHLY"; label: string }[] = [
  { value: "HOURLY", label: "時給" },
  { value: "DAILY", label: "日給" },
  { value: "MONTHLY", label: "月給" },
];

const NEW_TASK_NAME_SENTINEL = "__new__";

// 単価は上書きしない — 編集は新しいバージョンを開始日付きで積む。削除は
// 承認済みの実績シフトで一度も参照されていないものだけ可能（間違い登録の
// 取消し用）。既に使われた単価は削除できず、そのまま残しておく。
function PlacementRatesTab({
  relationshipId,
  rates,
  knownTaskNames,
  onChanged,
}: {
  relationshipId: string;
  rates: PlacementRate[];
  knownTaskNames: string[];
  onChanged: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [amendingId, setAmendingId] = useState<string | null>(null);
  const [amendWageType, setAmendWageType] = useState<"HOURLY" | "DAILY" | "MONTHLY">("HOURLY");
  const [amendAmount, setAmendAmount] = useState("");
  const [amendEffectiveFrom, setAmendEffectiveFrom] = useState(todayJst());
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTaskNameMode, setNewTaskNameMode] = useState<"pick" | "custom">("custom");
  const [newTaskName, setNewTaskName] = useState("");
  const [newWageType, setNewWageType] = useState<"HOURLY" | "DAILY" | "MONTHLY">("HOURLY");
  const [newAmount, setNewAmount] = useState("");
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(todayJst());

  function openNewForm() {
    setShowNewForm(true);
    setNewTaskName("");
    setNewTaskNameMode(knownTaskNames.length > 0 ? "pick" : "custom");
  }

  const amendingRate = rates.find((r) => r.id === amendingId) ?? null;

  function startAmend(r: PlacementRate) {
    setAmendingId(r.id);
    setAmendWageType("HOURLY");
    setAmendAmount("");
    setAmendEffectiveFrom(todayJst());
  }

  function submitAmend(r: PlacementRate) {
    if (!amendAmount) return;
    startTransition(async () => {
      await addPlacementRateVersionAction({
        companyRelationshipId: relationshipId,
        taskName: r.taskName,
        wageType: amendWageType,
        amount: Number(amendAmount),
        effectiveFrom: amendEffectiveFrom,
      });
      setAmendingId(null);
      await onChanged();
    });
  }

  function submitDelete(r: PlacementRate) {
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deletePlacementTaskNameAction(r.id);
        await onChanged();
      } catch {
        setDeleteError({ id: r.id, message: "この業務内容は請求計算の実績で使用されているため削除できません。" });
      }
    });
  }

  function submitNewTask() {
    if (!newTaskName.trim() || !newAmount) return;
    startTransition(async () => {
      await addPlacementRateVersionAction({
        companyRelationshipId: relationshipId,
        taskName: newTaskName.trim(),
        wageType: newWageType,
        amount: Number(newAmount),
        effectiveFrom: newEffectiveFrom,
      });
      setShowNewForm(false);
      setNewTaskName("");
      setNewAmount("");
      setNewEffectiveFrom(todayJst());
      await onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-1 flex items-center justify-end">
        <button
          type="button"
          onClick={openNewForm}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          ＋業務内容を追加
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {rates.map((r) => {
          const isUnpriced = r.versions.length === 0;
          return (
            <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.taskName}</span>
                <span className={isUnpriced ? "text-amber-700" : "text-muted"}>{r.currentLabel}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {r.versions.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className="text-muted hover:text-primary"
                  >
                    {expandedId === r.id ? "▲ 履歴を閉じる" : `▼ 履歴（${r.versions.length}件）`}
                  </button>
                ) : null}
                <button type="button" onClick={() => startAmend(r)} className="text-primary hover:underline">
                  単価を変更
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submitDelete(r)}
                  className="text-muted hover:text-red-600 disabled:opacity-60"
                >
                  削除
                </button>
              </div>

              {deleteError?.id === r.id ? <p className="mt-1 text-xs text-red-600">{deleteError.message}</p> : null}

              {expandedId === r.id ? (
                <ul className="mt-2 flex flex-col text-xs text-muted">
                  {r.versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between border-t border-border/50 py-1">
                      <span>{v.effectiveFrom} 〜</span>
                      <span>{v.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

            </li>
          );
        })}
        {rates.length === 0 ? <p className="py-6 text-center text-sm text-muted">業務内容が登録されていません。</p> : null}
      </ul>

      {amendingRate ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setAmendingId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">単価を変更（{amendingRate.taskName}）</h4>
              <button type="button" onClick={() => setAmendingId(null)} aria-label="閉じる" className="text-muted hover:text-primary">
                ✕
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <select
                value={amendWageType}
                onChange={(e) => setAmendWageType(e.target.value as "HOURLY" | "DAILY" | "MONTHLY")}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              >
                {WAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={amendAmount}
                onChange={(e) => setAmendAmount(e.target.value)}
                placeholder="金額"
                className="w-24 rounded-lg border border-border px-2 py-2 text-sm"
              />
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                開始日
                <input
                  type="date"
                  value={amendEffectiveFrom}
                  onChange={(e) => setAmendEffectiveFrom(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pending || !amendAmount}
              onClick={() => submitAmend(amendingRate)}
              className="mt-3 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              保存
            </button>
          </div>
        </div>
      ) : null}

      {showNewForm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowNewForm(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">業務内容を追加</h4>
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                aria-label="閉じる"
                className="text-muted hover:text-primary"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {newTaskNameMode === "pick" ? (
                <select
                  value={newTaskName}
                  onChange={(e) => {
                    if (e.target.value === NEW_TASK_NAME_SENTINEL) {
                      setNewTaskNameMode("custom");
                      setNewTaskName("");
                    } else {
                      setNewTaskName(e.target.value);
                    }
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="">業務内容を選択</option>
                  {knownTaskNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value={NEW_TASK_NAME_SENTINEL}>＋ 新しい業務内容を追加する</option>
                </select>
              ) : (
                <div className="flex flex-col gap-1">
                  <input
                    type="text"
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    placeholder="業務内容（例：キャディ業務）"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  />
                  {knownTaskNames.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNewTaskNameMode("pick");
                        setNewTaskName("");
                      }}
                      className="self-start text-xs text-muted hover:text-primary"
                    >
                      ← 既存の業務内容から選ぶ
                    </button>
                  ) : null}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <select
                  value={newWageType}
                  onChange={(e) => setNewWageType(e.target.value as "HOURLY" | "DAILY" | "MONTHLY")}
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                >
                  {WAGE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  placeholder="金額"
                  className="w-24 rounded-lg border border-border px-2 py-2 text-sm"
                />
                <label className="flex flex-col gap-0.5 text-xs text-muted">
                  開始日
                  <input
                    type="date"
                    value={newEffectiveFrom}
                    onChange={(e) => setNewEffectiveFrom(e.target.value)}
                    className="rounded-lg border border-border px-2 py-2 text-sm"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={pending || !newTaskName.trim() || !newAmount}
                onClick={submitNewTask}
                className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

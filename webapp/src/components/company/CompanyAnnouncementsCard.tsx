"use client";

import { useState, useTransition } from "react";
import {
  createCompanyAnnouncementAction,
  updateCompanyAnnouncementAction,
  deleteCompanyAnnouncementAction,
} from "@/app/company/actions";
import { NoteAttachmentList, NoteAttachmentPicker } from "@/components/NoteAttachments";
import type { NoteAttachmentInput, NoteAttachmentView } from "@/lib/noteAttachments";

type Audience = "ALL" | "OWN" | "TEAMS" | "INDIVIDUAL";

type Announcement = {
  id: string;
  title: string;
  body: string;
  audienceLabel: string;
  createdAt: string;
  edited: boolean;
  attachments: (NoteAttachmentInput & { view: NoteAttachmentView })[];
};

function formatDate(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ダッシュボードの「スタッフへのお知らせ」。出したお知らせはスタッフの「お知らせ」に溜まり、
// 出すと必ずプッシュ通知が届く。出した後もタイトル・本文・添付は直せる（宛先は変えない）。
export function CompanyAnnouncementsCard({
  announcements,
  teams,
  staffOptions,
  canPostToAll,
  initialOpen = false,
  embedded = false,
}: {
  // trueならダッシュボードの「お知らせ」タブの中に入れる（枠と見出しを付けない）
  embedded?: boolean;
  announcements: Announcement[];
  // 宛先に選べるチーム（マネージャーは自分のチームだけ）
  teams: { id: string; name: string }[];
  // 個別に選ぶときの候補（自社スタッフ・派遣スタッフ）
  staffOptions: { userId: string; name: string; isAgency: boolean }[];
  // 本部の管理者・編集者はどの宛先にも出せる。マネージャーは自分のチーム宛てだけ
  canPostToAll: boolean;
  initialOpen?: boolean;
}) {
  const [showForm, setShowForm] = useState(initialOpen);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  if (!canPostToAll && teams.length === 0) return null;

  return (
    <section
      id="announcements"
      className={embedded ? "scroll-mt-20" : "mt-6 scroll-mt-20 rounded-2xl border border-border bg-white/60 p-5"}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        {embedded ? (
          <p className="text-xs text-muted">スタッフに出したお知らせです。出すとプッシュ通知が届きます。</p>
        ) : (
          <h2 className="font-serif-jp text-lg font-bold text-primary">スタッフへのお知らせ</h2>
        )}
        {!showForm ? (
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setResult(null);
            }}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
          >
            ＋お知らせを作成
          </button>
        ) : null}
      </div>
      {result ? <p className="mb-2 text-xs text-emerald-700">{result}</p> : null}

      {showForm ? (
        <AnnouncementForm
          mode="create"
          teams={teams}
          staffOptions={staffOptions}
          canPostToAll={canPostToAll}
          onCancel={() => setShowForm(false)}
          onDone={(message) => {
            setResult(message);
            setShowForm(false);
          }}
        />
      ) : null}

      {announcements.length === 0 ? (
        <p className="text-sm text-muted">まだお知らせはありません。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {announcements.map((a) => (
            <li key={a.id} className="rounded-xl border border-border bg-white px-3 py-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{a.title}</p>
                  {a.body ? <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-foreground/80">{a.body}</p> : null}
                  <NoteAttachmentList attachments={a.attachments.map((x) => x.view)} />
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(a.createdAt)} ／ {a.audienceLabel}
                    {a.edited ? "（編集済み）" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing(a)}
                    className="text-xs font-semibold text-primary"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(`「${a.title}」を削除しますか？スタッフのお知らせからも消えます。`)) return;
                      startTransition(() => deleteCompanyAnnouncementAction(a.id));
                    }}
                    className="text-xs font-semibold text-red-600 disabled:opacity-60"
                  >
                    削除
                  </button>
                </div>
              </div>
              {editing?.id === a.id ? (
                <div className="mt-3">
                  <AnnouncementForm
                    mode="edit"
                    announcement={a}
                    teams={teams}
                    staffOptions={staffOptions}
                    canPostToAll={canPostToAll}
                    onCancel={() => setEditing(null)}
                    onDone={() => setEditing(null)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AnnouncementForm({
  mode,
  announcement,
  teams,
  staffOptions,
  canPostToAll,
  onCancel,
  onDone,
}: {
  mode: "create" | "edit";
  announcement?: Announcement;
  teams: { id: string; name: string }[];
  staffOptions: { userId: string; name: string; isAgency: boolean }[];
  canPostToAll: boolean;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [attachments, setAttachments] = useState<NoteAttachmentInput[]>(
    announcement?.attachments.map(({ url, fileName, contentType, size }) => ({ url, fileName, contentType, size })) ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [audience, setAudience] = useState<Audience>(canPostToAll ? "ALL" : "TEAMS");
  const [teamIds, setTeamIds] = useState<string[]>(!canPostToAll && teams.length === 1 ? [teams[0].id] : []);
  const [staffUserIds, setStaffUserIds] = useState<string[]>([]);
  const [staffQuery, setStaffQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const audienceReady =
    mode === "edit" ||
    (audience === "TEAMS" ? teamIds.length > 0 : audience === "INDIVIDUAL" ? staffUserIds.length > 0 : true);

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        if (mode === "edit" && announcement) {
          await updateCompanyAnnouncementAction(announcement.id, { title, body, attachments });
          onDone("お知らせを直しました");
        } else {
          const r = await createCompanyAnnouncementAction({ title, body, audience, teamIds, staffUserIds, attachments });
          onDone(`${r.recipientCount}人にお知らせしました`);
        }
      } catch {
        setError(
          mode === "edit" ? "保存できませんでした。もう一度お試しください。" : "お知らせを出せませんでした。宛先を確かめてもう一度お試しください。",
        );
      }
    });
  }

  const filteredStaff = staffOptions.filter((s) => !staffQuery.trim() || s.name.includes(staffQuery.trim()));

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-white p-4">
      <label className="flex flex-col gap-1 text-xs">
        件名（必須）
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例：年末年始の営業について"
          className="rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        本文
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>
      <NoteAttachmentPicker value={attachments} onChange={setAttachments} onUploadingChange={setUploading} />

      {mode === "create" ? (
        <>
          <label className="flex flex-col gap-1 text-xs">
            宛先
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as Audience)}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              {canPostToAll ? (
                <>
                  <option value="ALL">全スタッフ（自社＋派遣）</option>
                  <option value="OWN">自社スタッフのみ</option>
                </>
              ) : null}
              <option value="TEAMS">チームを選ぶ</option>
              {canPostToAll ? <option value="INDIVIDUAL">個別に選ぶ</option> : null}
            </select>
          </label>

          {audience === "TEAMS" ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="チーム">
              {teams.map((t) => (
                <label key={t.id} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={teamIds.includes(t.id)}
                    onChange={() => setTeamIds((v) => toggle(v, t.id))}
                    className="h-4 w-4"
                  />
                  {t.name}
                </label>
              ))}
            </div>
          ) : null}

          {audience === "INDIVIDUAL" ? (
            <div className="flex flex-col gap-2">
              <input
                type="search"
                value={staffQuery}
                onChange={(e) => setStaffQuery(e.target.value)}
                placeholder="名前で探す"
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted">{staffUserIds.length}人を選択中</p>
              <div className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2" role="group" aria-label="スタッフ">
                {filteredStaff.map((s) => (
                  <label key={s.userId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={staffUserIds.includes(s.userId)}
                      onChange={() => setStaffUserIds((v) => toggle(v, s.userId))}
                      className="h-4 w-4"
                    />
                    {s.name}
                    {s.isAgency ? <span className="text-xs text-muted">（派遣）</span> : null}
                  </label>
                ))}
                {filteredStaff.length === 0 ? <p className="text-xs text-muted">見つかりません</p> : null}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted">出すと、宛先のスタッフにプッシュ通知が届きます。</p>
        </>
      ) : (
        <p className="text-xs text-muted">直した内容は、受け取ったスタッフのお知らせにも反映されます（通知は送り直しません）。宛先は変えられません。</p>
      )}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || uploading || !title.trim() || !audienceReady}
          onClick={submit}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {mode === "edit" ? "保存する" : "お知らせを出す"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">
          やめる
        </button>
      </div>
    </div>
  );
}

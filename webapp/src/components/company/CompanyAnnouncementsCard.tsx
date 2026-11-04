"use client";

import { useState, useTransition } from "react";
import { createCompanyAnnouncementAction, deleteCompanyAnnouncementAction } from "@/app/company/actions";

type Announcement = {
  id: string;
  title: string;
  body: string;
  teamName: string | null;
  includeAgencyStaff: boolean;
  pushed: boolean;
  expiresOn: string | null;
  createdAt: string;
  recipientCount: number;
  readCount: number;
};

function formatDate(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ダッシュボードの「スタッフへのお知らせ」。書いたお知らせはスタッフのホームの「お知らせ」に出る。
export function CompanyAnnouncementsCard({
  announcements,
  teams,
  canPostToAll,
}: {
  announcements: Announcement[];
  // 宛先に選べるチーム（マネージャーは自分のチームだけ）
  teams: { id: string; name: string }[];
  // 自社スタッフ全員宛てに出せるか（本部の管理者・編集者）
  canPostToAll: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [teamId, setTeamId] = useState(canPostToAll ? "" : (teams[0]?.id ?? ""));
  const [includeAgencyStaff, setIncludeAgencyStaff] = useState(true);
  const [push, setPush] = useState(true);
  const [expiresOn, setExpiresOn] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canPostToAll && teams.length === 0) return null;

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await createCompanyAnnouncementAction({
          title,
          body,
          teamId: teamId || null,
          includeAgencyStaff,
          push,
          expiresOn: expiresOn || null,
        });
        setResult(`${r.recipientCount}人にお知らせしました`);
        setTitle("");
        setBody("");
        setExpiresOn("");
        setShowForm(false);
      } catch {
        setError("お知らせを出せませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-white/60 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-serif-jp text-lg font-bold text-primary">スタッフへのお知らせ</h2>
        {!showForm ? (
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setResult(null);
            }}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
          >
            ＋お知らせを出す
          </button>
        ) : null}
      </div>
      {result ? <p className="mb-2 text-xs text-emerald-700">{result}</p> : null}

      {showForm ? (
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
          <label className="flex flex-col gap-1 text-xs">
            宛先
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              {canPostToAll ? <option value="">自社スタッフ全員</option> : null}
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}のスタッフ
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeAgencyStaff}
              onChange={(e) => setIncludeAgencyStaff(e.target.checked)}
              className="h-4 w-4"
            />
            派遣スタッフ（派遣会社から来ているスタッフ）にも出す
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="h-4 w-4" />
            プッシュ通知も送る
          </label>
          <label className="flex flex-col gap-1 text-xs">
            掲載期限（この日を過ぎたらスタッフのホームに出しません。空欄なら期限なし）
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
            />
          </label>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !title.trim()}
              onClick={submit}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              お知らせを出す
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              やめる
            </button>
          </div>
        </div>
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
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(a.createdAt)} ／ {a.teamName ? `${a.teamName}のスタッフ` : "自社スタッフ全員"}
                    {a.includeAgencyStaff ? "＋派遣スタッフ" : ""} ／ 既読 {a.readCount}/{a.recipientCount}人
                    {a.expiresOn ? ` ／ ${a.expiresOn.slice(5).replace("-", "/")}まで` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`「${a.title}」を削除しますか？スタッフのホームからも消えます。`)) return;
                    startTransition(() => deleteCompanyAnnouncementAction(a.id));
                  }}
                  className="shrink-0 text-xs font-semibold text-red-600 disabled:opacity-60"
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

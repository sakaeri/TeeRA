"use client";

import { useState, useTransition } from "react";
import { applyToRecruitmentAction } from "@/app/staff/actions";

type Row = {
  id: string;
  title: string;
  companyName: string;
  visibility: "ORDER" | "PUBLIC";
  date: string;
  startTime: string | null;
  endTime: string | null;
  isUndecided: boolean;
  note: string | null;
  announcements: string[];
  hourlyWage: number | null;
  wageType: string | null;
  extraItems: { label: string; value: string }[];
  maxEntries: number;
  filled: number;
  alreadyApplied: boolean;
  isAffiliated: boolean;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateJa(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return `${m}月${d}日（${WEEKDAYS[dow]}）`;
}

// 見出しは「日付」「募集企業名・残り人数」だけに絞り、業務内容・時間・
// 給与などの詳細は▼で開くまで隠す。応募するかどうかは詳細を見てから
// 判断するものなので、タップで展開→内容確認→応募する、という導線は
// そのまま保つ（一発ボタンでの誤応募を防ぐ）。
export function RecruitmentListView({ recruitments }: { recruitments: Row[] }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  // 応募する前に、内容を確かめてもらう
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function apply(id: string) {
    startTransition(async () => {
      const result = await applyToRecruitmentAction(id);
      if (result.error) {
        setErrors((prev) => ({
          ...prev,
          [id]: result.error === "recruitment_full" ? "満員になりました。" : "応募できませんでした。",
        }));
      } else {
        setApplied((prev) => ({ ...prev, [id]: true }));
      }
    });
  }

  return (
    <ul className="flex flex-col gap-2">
      {recruitments.map((r) => {
        const remaining = Math.max(r.maxEntries - r.filled, 0);
        const isFull = remaining <= 0;
        const isApplied = applied[r.id] || r.alreadyApplied;
        // 所属先（自社／配属済みの依頼主）が出した公開募集は、一覧には
        // 出すが詳細は開けないようにする — 公開募集の賃金は所属の無い
        // スタッフ向けのもので、契約済みの単価と違って見えると無用な
        // 不満につながるため（実際の支給額は契約単価の方が使われる）。
        const hideDetail = r.visibility === "PUBLIC" && r.isAffiliated;
        const open = !hideDetail && openId === r.id;
        const location = r.extraItems.find((i) => i.label === "勤務地")?.value;
        const otherExtraItems = r.extraItems.filter((i) => i.label !== "勤務地");
        return (
          <li
            key={r.id}
            data-testid={`recruitment-${r.id}`}
            className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5"
          >
            <button
              type="button"
              disabled={hideDetail}
              onClick={() => setOpenId(open ? null : r.id)}
              className="flex w-full flex-col gap-1 px-4 py-3 text-left disabled:cursor-default"
            >
              <span className="text-xs text-muted">{formatDateJa(r.date)}</span>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                  {r.visibility === "PUBLIC" ? (
                    <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                      公開募集
                    </span>
                  ) : null}
                  <span className="truncate">{r.companyName}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {isApplied ? (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">応募済み</span>
                  ) : isFull ? (
                    <span className="rounded-full bg-background px-2 py-0.5">満員</span>
                  ) : (
                    <span>残り{remaining}名</span>
                  )}
                  {hideDetail ? null : (
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                    >
                      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </div>
              {location && !hideDetail ? <span className="text-xs text-muted">勤務地：{location}</span> : null}
            </button>
            {open ? (
              <div className="flex flex-col gap-2 border-t border-black/5 px-4 py-3 text-sm">
                <p>
                  <span className="mr-1 text-xs text-muted">業務内容</span>
                  {r.title}
                </p>
                <p>
                  <span className="mr-1 text-xs text-muted">時間</span>
                  {r.isUndecided || (!r.startTime && !r.endTime) ? "未定" : `${r.startTime ?? ""}〜${r.endTime ?? ""}`}
                </p>
                {r.hourlyWage ? (
                  <p>
                    <span className="mr-1 text-xs text-muted">給与</span>
                    {r.wageType === "DAILY" ? "日給" : "時給"}
                    {r.hourlyWage}円
                  </p>
                ) : null}
                {otherExtraItems.map((item) => (
                  <p key={item.label}>
                    <span className="mr-1 text-xs text-muted">{item.label}</span>
                    {item.value}
                  </p>
                ))}
                {r.note ? (
                  <p className="whitespace-pre-wrap">
                    <span className="mr-1 text-xs text-muted">備考</span>
                    {r.note}
                  </p>
                ) : null}
                {r.announcements.length > 0 ? (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="mb-1 font-semibold">追加のお知らせ</p>
                    {r.announcements.map((body, i) => (
                      <p key={i} className="whitespace-pre-wrap">
                        {body}
                      </p>
                    ))}
                  </div>
                ) : null}
                {errors[r.id] ? <p className="text-xs text-red-600">{errors[r.id]}</p> : null}
                <button
                  type="button"
                  disabled={pending || isFull || isApplied}
                  onClick={() => setConfirmId(r.id)}
                  className="mt-1 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {isApplied ? "応募済み" : isFull ? "満員" : "応募する"}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
      {recruitments.length === 0 ? (
        <p className="text-sm text-muted">現在募集中のシフトはありません。</p>
      ) : null}
      {(() => {
        const target = recruitments.find((r) => r.id === confirmId);
        if (!target) return null;
        return (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmId(null)}>
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <p className="mb-1 font-serif-jp text-base font-bold text-primary">この募集に応募しますか？</p>
              <p className="mb-4 text-sm text-muted">
                {formatDateJa(target.date)} {target.companyName}
                <br />
                {target.title}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-sm"
                >
                  やめる
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmId(null);
                    apply(target.id);
                  }}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  応募する
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </ul>
  );
}

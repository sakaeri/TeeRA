"use client";

import { useState, useTransition } from "react";
import {
  clockInAction,
  clockOutAndSubmitAction,
  saveWorkReportDraftAction,
  submitWorkReportAction,
  confirmCorrectedWorkReportAction,
  disputeCorrectedWorkReportAction,
} from "@/app/staff/actions";
import { isDone, type ShiftRow } from "@/lib/staffShiftStatus";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { todayJst } from "@/lib/date";
import { UnscheduledReportButton, type UnscheduledCompanyOption } from "@/components/staff/UnscheduledReportForm";
import { showToast } from "@/components/Toast";

export type { ShiftRow };
export { isDone };

const APPROVAL_LABEL: Record<string, string> = {
  PENDING: "承認待ち",
  APPROVED: "承認済み",
  REJECTED: "差し戻し",
  NEEDS_CONFIRMATION: "要確認",
};

// 会社側カレンダーのAPPROVAL_PILLと配色を揃える（PENDING=amber/APPROVED=
// sky/REJECTED=rose）。NEEDS_CONFIRMATIONはスタッフ側にしか出ない状態
// なので、これまで通りaccent系のままにする。
const APPROVAL_PILL: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-sky-100 text-sky-800",
  REJECTED: "bg-rose-100 text-rose-800",
  NEEDS_CONFIRMATION: "bg-accent/20 text-accent",
};

const NEW_TASK_NAME_SENTINEL = "__new__";

// 労基法の目安（6時間超で45分、8時間超で60分）を踏まえたよくある休憩時間
// をボタンで即選択できるようにする — 手入力欄は細かい調整用に残す。
const BREAK_MINUTE_PRESETS = [0, 30, 45, 60, 90];

export function StaffTimecardView({
  shifts,
  knownTaskNamesByCompany,
  unscheduledCompanies,
  openUnscheduled = false,
  openBulk = false,
}: {
  shifts: ShiftRow[];
  knownTaskNamesByCompany: Record<string, string[]>;
  unscheduledCompanies: UnscheduledCompanyOption[];
  openUnscheduled?: boolean;
  openBulk?: boolean;
}) {
  const actionable = shifts.filter((s) => !isDone(s));
  const done = shifts.filter(isDone);
  // 「未提出」（退勤済み・過去日・差し戻し等で報告が必要なもの）を一番上に
  // まとめ、今日これから勤務するシフトとは分ける — 以前は日付の新しい順に
  // 混ざって並んでいたため、今日のシフトの下に未提出の過去分が埋もれていた。
  const unsubmitted = actionable.filter(needsReportNow);
  // 今日提出した承認待ちの報告は「今日のシフト」に残す（提出できたことと、承認前なら
  // 「修正する」から直せることが見えるように。閉じた「過去の報告」に入ると見えなくなる）
  const today = todayJst();
  const isTodaySubmitted = (s: ShiftRow) => s.date === today && s.approvalStatus === "PENDING" && isDone(s);
  const upcomingToday = [...actionable.filter((s) => !needsReportNow(s)), ...done.filter(isTodaySubmitted)];
  const pastDone = done.filter((s) => !isTodaySubmitted(s));
  // まとめて報告できるもの：前日以前で、まだ一度も出していない報告（差し戻しは理由を見て1件ずつ直す）
  const bulkTargets = unsubmitted.filter((s) => s.date < today && !s.submittedAt && !s.rejectionReason);
  const [showBulk, setShowBulk] = useState(openBulk && bulkTargets.length >= 2);

  return (
    <div className="flex flex-col gap-6">
      {bulkTargets.length >= 2 ? (
        <button
          type="button"
          onClick={() => setShowBulk(true)}
          className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-sm"
          data-testid="bulk-report-open"
        >
          まとめて報告（{bulkTargets.length}件）
        </button>
      ) : null}
      {showBulk ? <BulkReportModal shifts={bulkTargets} onClose={() => setShowBulk(false)} /> : null}
      {unsubmitted.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-bold text-red-700">未提出の業務報告（{unsubmitted.length}件）</h2>
          <ul className="flex flex-col gap-4">
            {unsubmitted.map((s) => (
              <ShiftCard key={s.id} shift={s} knownTaskNames={knownTaskNamesByCompany[s.companyId] ?? []} workplaces={unscheduledCompanies.find((c) => c.companyId === s.companyId)?.workplaces ?? []} />
            ))}
          </ul>
        </section>
      ) : null}

      {upcomingToday.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-bold text-muted">今日のシフト</h2>
          <ul className="flex flex-col gap-4">
            {upcomingToday.map((s) => (
              <ShiftCard key={s.id} shift={s} knownTaskNames={knownTaskNamesByCompany[s.companyId] ?? []} workplaces={unscheduledCompanies.find((c) => c.companyId === s.companyId)?.workplaces ?? []} />
            ))}
          </ul>
        </section>
      ) : null}

      {shifts.length === 0 ? <p className="text-sm text-muted">対象のシフトがありません。</p> : null}
      {shifts.length > 0 && actionable.length === 0 ? (
        <p className="text-sm text-muted">対応が必要な報告はありません。</p>
      ) : null}

      <UnscheduledReportButton
        companies={unscheduledCompanies}
        knownTaskNamesByCompany={knownTaskNamesByCompany}
        initialOpen={openUnscheduled}
      />

      {pastDone.length > 0 ? (
        <details className="rounded-2xl bg-white/70 p-4 shadow-sm ring-1 ring-black/5">
          <summary className="cursor-pointer text-sm font-semibold text-muted">
            過去の報告（{pastDone.length}件）
          </summary>
          <ul className="mt-3 flex flex-col gap-4">
            {pastDone.map((s) => (
              <ShiftCard key={s.id} shift={s} knownTaskNames={knownTaskNamesByCompany[s.companyId] ?? []} workplaces={unscheduledCompanies.find((c) => c.companyId === s.companyId)?.workplaces ?? []} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// 今すぐ報告が必要か（退勤済み・過去日・差し戻し・修正の確認待ち）。
// 今日これから勤務する（まだ退勤していない）シフトはfalse。
export function needsReportNow(shift: ShiftRow) {
  if (isDone(shift)) return false;
  return (
    shift.date < todayJst() ||
    Boolean(shift.clockOut) ||
    shift.approvalStatus === "REJECTED" ||
    shift.approvalStatus === "NEEDS_CONFIRMATION"
  );
}

export function ShiftCard({
  shift,
  knownTaskNames,
  workplaces = [],
}: {
  shift: ShiftRow;
  knownTaskNames: string[];
  // 勤務先として選べる依頼主（本人が配属されている依頼主）。社内はいつでも選べる
  workplaces?: { companyRelationshipId: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  // 勤務先（当日に別の現場へ回った時に変える）。"" は社内
  const [workplaceId, setWorkplaceId] = useState(shift.companyRelationshipId ?? "");
  const workplaceChanged = workplaceId !== (shift.companyRelationshipId ?? "");
  const [comment, setComment] = useState(shift.comment ?? "");
  const [taskName, setTaskName] = useState(shift.taskName ?? "");
  const [taskNameMode, setTaskNameMode] = useState<"pick" | "custom">(
    knownTaskNames.length > 0 ? "pick" : "custom",
  );
  const [error, setError] = useState<string | null>(null);
  const [breakMinutes, setBreakMinutes] = useState(String(shift.breakMinutes ?? 0));
  // 提出済み（承認待ち）の内容を本人が直すとき
  const [editing, setEditing] = useState(false);
  const [confirmOutcome, setConfirmOutcome] = useState<"ABSENT" | "CANCELLED_BY_EMPLOYER" | null>(null);
  // 打刻時刻は自動記録だが、押し忘れ・押し間違いを本人が直せるよう提出前
  // に限り手修正を許す（承認/差し戻しという既存のチェックが最終的な歯止め
  // になるため）。
  const [clockInEdit, setClockInEdit] = useState(shift.clockInTime ?? "");
  const [clockOutEdit, setClockOutEdit] = useState(shift.clockOutTime ?? "");
  // このカードは出勤→退勤の間もshift.id単位で同じコンポーネントインスタンス
  // のまま再利用されるため、useStateの初期値だけでは打刻直後の新しい
  // clockInTime/clockOutTimeを拾えない（初期化はマウント時の1回きり）。
  // レンダー中にprops側の値の変化を検知して同期する（Reactの推奨パターン
  // — useEffectで追従させるとカスケードレンダーの警告になるため）。
  const [prevClockInTime, setPrevClockInTime] = useState(shift.clockInTime);
  if (shift.clockInTime !== prevClockInTime) {
    setPrevClockInTime(shift.clockInTime);
    setClockInEdit(shift.clockInTime ?? "");
  }
  const [prevClockOutTime, setPrevClockOutTime] = useState(shift.clockOutTime);
  if (shift.clockOutTime !== prevClockOutTime) {
    setPrevClockOutTime(shift.clockOutTime);
    setClockOutEdit(shift.clockOutTime ?? "");
  }

  const finalized = shift.outcome && shift.outcome !== "WORKED";
  const readyToSubmit = shift.clockIn && shift.clockOut;
  // 過去のシフトを後日まとめて報告する場合、「勤務開始/勤務終了」ボタンは
  // 押した瞬間（＝今日）の日付が打刻として記録されてしまい、シフト自体の
  // 予定日とズレてしまう。過去日のシフトは打刻ボタンを出さず、最初から
  // 時刻を直接入力するフォームにする（domain側のsubmitWorkReportも、
  // 打刻が一度も無い状態からの提出はシフトの予定日を基準にするよう対応済み
  // — workReports.ts参照）。
  const isPastShift = shift.date < todayJst();
  // 休憩を確定させる前の実働時間プレビュー — 手修正した打刻時刻(HH:MM)を
  // 使って計算する。サーバー側（withJstTime）は出勤・退勤それぞれ元の暦日
  // （shift.clockIn/clockOutの実際の日付）はそのまま保ち、時刻だけを置き
  // 換える。ここでもHH:MM同士を日付を無視して比較すると、深夜またぎシフト
  // （出勤23:55→退勤07:55など）を「退勤が出勤より前」と誤判定してしまう
  // ため、同じくreferenceの暦日を保つ計算にして、プレビューと実際の送信
  // 結果が食い違わないようにする。
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  function withJstTime(reference: Date, hhmm: string): Date {
    const [h, m] = hhmm.split(":").map(Number);
    const jst = new Date(reference.getTime() + JST_OFFSET_MS);
    return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), h, m) - JST_OFFSET_MS);
  }
  // 打刻が一度も無い過去シフトの手入力では、shift.clockIn/clockOutが両方
  // nullなので、上と同じくどこかの暦日を基準に据える必要がある（プレビュー
  // なので日付自体はどこでもよく、出勤・退勤で同じ基準日を使えれば足りる）。
  // サーバー側（submitWorkReport）の判定と合わせ、退勤時刻の文字列が出勤
  // 時刻より前なら深夜またぎとみなして退勤側だけ+1日する。
  const clockInRef = shift.clockIn ? new Date(shift.clockIn) : new Date();
  const clockOutRef = shift.clockOut
    ? new Date(shift.clockOut)
    : clockInEdit && clockOutEdit && clockOutEdit < clockInEdit
      ? new Date(clockInRef.getTime() + 24 * 60 * 60 * 1000)
      : clockInRef;
  const liveRawMinutes =
    clockInEdit && clockOutEdit
      ? Math.round(
          (withJstTime(clockOutRef, clockOutEdit).getTime() - withJstTime(clockInRef, clockInEdit).getTime()) /
            60000,
        ) - (Number(breakMinutes) || 0)
      : 0;
  const liveComputedMinutes = Math.max(liveRawMinutes, 0);
  const hasInvalidTimeRange = Boolean(clockInEdit && clockOutEdit && liveRawMinutes <= 0);
  // 提出済み（差し戻し以外）は編集フォームを出さず、読み取り専用の
  // 報告内容にする。承認済みかどうかは上のバッジで分かるので、ここでは
  // 「何を報告したか」だけ分かれば十分（差し戻し=REJECTEDだけは修正して
  // 再提出できるよう、下の編集フォームのまま残す）。isDone()の判定と揃えている。
  const submitted =
    shift.outcome === "WORKED" &&
    Boolean(shift.submittedAt) &&
    (shift.approvalStatus === "PENDING" || shift.approvalStatus === "APPROVED");

  // 退勤済み（または過去日）なのにまだ提出していない — 退勤を押した時点で
  // 終わった気になって提出し忘れることが多かったため、目立たせる
  const awaitingSubmit =
    !submitted &&
    !finalized &&
    shift.approvalStatus !== "NEEDS_CONFIRMATION" &&
    shift.approvalStatus !== "REJECTED" &&
    (Boolean(shift.clockOut) || isPastShift);

  // 勤務中（出勤済み・まだ勤務終了していない今日のシフト）
  const inProgress = Boolean(shift.clockIn) && !shift.clockOut && !isPastShift && !submitted && !finalized;

  // 勤務中に入れた内容をその場で保存する（再読み込みしても残るように）。
  // 提出は「勤務終了」で、そのとき画面の値も一緒に送るので、ここが間に合わなくても困らない。
  function saveDraft(patch: { breakMinutes?: number; taskName?: string | null; comment?: string | null; clockInTime?: string }) {
    if (!inProgress) return;
    saveWorkReportDraftAction({ shiftId: shift.id, ...patch }).catch(() =>
      setError("保存できませんでした。電波の良いところでもう一度お試しください。"),
    );
  }

  const breakInput = (
    <div>
      <p className="mb-1 text-xs text-muted">休憩時間</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {BREAK_MINUTE_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setBreakMinutes(String(m));
              saveDraft({ breakMinutes: m });
            }}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              Number(breakMinutes) === m
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "border-border text-foreground"
            }`}
          >
            {m}分
          </button>
        ))}
        <input
          type="number"
          min="0"
          value={breakMinutes}
          onChange={(e) => setBreakMinutes(e.target.value)}
          onBlur={() => saveDraft({ breakMinutes: Number(breakMinutes) || 0 })}
          className="w-16 rounded-lg border border-border px-2 py-1 text-xs"
        />
        <span className="text-xs text-muted">分</span>
      </div>
    </div>
  );

  const taskNameInput = (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="text-muted">業務内容</span>
      {taskNameMode === "pick" ? (
        <select
          value={taskName}
          onChange={(e) => {
            if (e.target.value === NEW_TASK_NAME_SENTINEL) {
              setTaskNameMode("custom");
              setTaskName("");
            } else {
              setTaskName(e.target.value);
              saveDraft({ taskName: e.target.value || null });
            }
          }}
          className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
        >
          <option value="">未選択</option>
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
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            onBlur={() => saveDraft({ taskName: taskName.trim() || null })}
            placeholder="業務内容（例：キャディ業務）"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
          {knownTaskNames.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setTaskNameMode("pick");
                setTaskName(shift.taskName ?? "");
              }}
              className="self-start text-xs text-muted hover:text-primary"
            >
              ← 既存の業務内容から選ぶ
            </button>
          ) : null}
        </div>
      )}
    </label>
  );

  // 勤務先の選択（配属先が無い人には出さない）。変えると、提出した時に新しい勤務先へ振り替わり、承認は新しい勤務先がする
  const workplaceInput =
    workplaces.length > 0 || shift.companyRelationshipId ? (
      <label className="flex flex-col gap-0.5 text-xs">
        <span className="text-muted">勤務先</span>
        <select
          value={workplaceId}
          onChange={(e) => setWorkplaceId(e.target.value)}
          className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
          data-testid="report-workplace"
        >
          <option value="">社内</option>
          {shift.companyRelationshipId && !workplaces.some((w) => w.companyRelationshipId === shift.companyRelationshipId) ? (
            <option value={shift.companyRelationshipId}>{shift.workplaceName ?? "依頼主"}</option>
          ) : null}
          {workplaces.map((w) => (
            <option key={w.companyRelationshipId} value={w.companyRelationshipId}>
              {w.name}
            </option>
          ))}
        </select>
        {workplaceChanged ? (
          <span className="text-amber-700">提出すると、この勤務先に振り替わります（元の勤務先は取り消しになり、承認は新しい勤務先がします）。</span>
        ) : null}
      </label>
    ) : null;

  const commentInput = (
    <textarea
      value={comment}
      onChange={(e) => setComment(e.target.value)}
      onBlur={() => saveDraft({ comment: comment || null })}
      placeholder="コメント（任意）"
      className="w-full rounded-lg border border-border px-3 py-2 text-sm"
      rows={2}
    />
  );

  return (
    <li
      id={`shift-${shift.id}`}
      className={`scroll-mt-24 rounded-2xl bg-white p-5 shadow-sm ${awaitingSubmit ? "ring-2 ring-amber-400" : "ring-1 ring-black/5"}`}
    >
      {awaitingSubmit ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          まだ業務報告を提出していません。内容を確認して「業務報告を提出する」を押してください。
        </p>
      ) : null}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="min-w-0 font-medium">{shift.date}</span>
        {/* approvalStatusは出勤した瞬間からデフォルトでPENDINGが入っている
            （「打刻しただけ」と「実際に提出した」を区別する唯一の目印は
            submittedAt）。ここで判定を絞らないと、出勤ボタンを押しただけで
            「承認待ち」バッジが出てしまう。 */}
        {shift.approvalStatus && shift.submittedAt ? (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
              APPROVAL_PILL[shift.approvalStatus] ?? "bg-accent/20 text-accent"
            }`}
          >
            {shift.approvalStatus === "PENDING" && shift.monthlyApproval
              ? "提出済み（締め日にまとめて確認）"
              : (APPROVAL_LABEL[shift.approvalStatus] ?? shift.approvalStatus)}
          </span>
        ) : null}
      </div>
      <p className="mb-1 text-sm text-muted">{shift.companyName}</p>
      {submitted ? null : (
        <p className="mb-2 text-sm text-muted">
          {shift.startTime ? `${shift.startTime}〜${shift.endTime}` : "終日/未定"}
        </p>
      )}
      {shift.workplaceName ? <p className="mb-2 text-sm text-muted">勤務先：{shift.workplaceName}</p> : null}
      {shift.approvalStatus === "REJECTED" && shift.rejectionReason ? (
        <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          差し戻し理由：{shift.rejectionReason}
        </p>
      ) : null}

      {shift.approvalStatus === "NEEDS_CONFIRMATION" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
          <p className="text-sm">
            企業が打刻内容を修正しました。内容を確認してください。
          </p>
          {shift.workplaceChangedFrom ? (
            <p className="text-sm font-semibold" data-testid="workplace-changed">
              勤務先：{shift.workplaceChangedFrom} → {shift.workplaceName ?? "社内"}
            </p>
          ) : null}
          <p className="text-sm text-muted">
            {shift.clockInTime ?? "--:--"}〜{shift.clockOutTime ?? "--:--"}（休憩{shift.breakMinutes}分／実働{" "}
            {(shift.computedMinutes / 60).toFixed(1)} 時間）
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !shift.workReportId}
              onClick={() => {
                if (!shift.workReportId) return;
                startTransition(() => confirmCorrectedWorkReportAction(shift.workReportId!));
              }}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              これで合っています
            </button>
            {/* 修正内容に納得できない場合は差し戻し状態に戻し、自分で直して再提出する */}
            <button
              type="button"
              disabled={pending || !shift.workReportId}
              onClick={() => {
                if (!shift.workReportId) return;
                startTransition(() => disputeCorrectedWorkReportAction(shift.workReportId!));
              }}
              className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground/70 disabled:opacity-60"
            >
              内容が違う
            </button>
          </div>
        </div>
      ) : finalized ? (
        <p className="text-sm text-muted">
          {shift.outcome === "ABSENT" ? "欠勤として報告済みです。" : "勤務先からのキャンセルとして報告済みです。"}
        </p>
      ) : submitted && !editing ? (
        <>
          {shift.taskName ? <p className="mb-1 text-sm text-muted">{shift.taskName}</p> : null}
          <p className="text-sm text-muted">
            {shift.clockInTime ?? "--:--"}〜{shift.clockOutTime ?? "--:--"}（実働{" "}
            {(shift.computedMinutes / 60).toFixed(1)} 時間／休憩{shift.breakMinutes}分）
          </p>
          {shift.approvalStatus === "PENDING" ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2">
              <p className="text-sm font-semibold text-emerald-800">✓ 業務報告を提出しました</p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-800"
              >
                修正する
              </button>
              <p className="w-full text-xs text-emerald-800/80">承認されるまでは、時刻や休憩を修正できます。</p>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {!(shift.clockIn && shift.clockOut) && !isPastShift ? (
            !shift.clockIn ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => clockInAction(shift.id))}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                {pending ? "記録中…" : "勤務開始"}
              </button>
            ) : (
              // 勤務中：休憩などは働いている間にいつでも入れておける。「勤務終了」で提出まで済む
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-primary">勤務中</p>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted">出勤時刻（押し間違えたら直せます）</span>
                  <input
                    type="time"
                    value={clockInEdit}
                    onChange={(e) => setClockInEdit(e.target.value)}
                    onBlur={() => {
                      if (clockInEdit && clockInEdit !== shift.clockInTime) saveDraft({ clockInTime: clockInEdit });
                    }}
                    className="w-32 rounded-lg border border-border px-2 py-2 text-sm text-foreground"
                  />
                </label>
                {breakInput}
                {taskNameInput}
                {commentInput}
                {error ? <p className="text-xs text-red-600">{error}</p> : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      try {
                        await clockOutAndSubmitAction({
                          shiftId: shift.id,
                          breakMinutes: Number(breakMinutes) || 0,
                          taskName: taskName.trim() || null,
                          comment: comment || null,
                          // 本人が直したときだけ送る（画面を開いたままの間に別の所で直された時刻を古い値で上書きしない）
                          clockInTime: clockInEdit && clockInEdit !== shift.clockInTime ? clockInEdit : undefined,
                        });
                        showToast("勤務終了・業務報告を提出しました ✓");
                      } catch {
                        setError("提出できませんでした。電波の良いところでもう一度「勤務終了」を押してください。");
                      }
                    })
                  }
                  className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
                >
                  {pending ? "送信中…" : "勤務終了（業務報告を提出）"}
                </button>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted">出勤時刻</span>
                  <input
                    type="time"
                    value={clockInEdit}
                    onChange={(e) => setClockInEdit(e.target.value)}
                    className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted">退勤時刻</span>
                  <input
                    type="time"
                    value={clockOutEdit}
                    onChange={(e) => setClockOutEdit(e.target.value)}
                    className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
                  />
                </label>
              </div>
              <p className="text-xs text-muted">
                {isPastShift
                  ? "実際に勤務した時刻を入力してください。"
                  : "押し忘れ・押し間違いがあれば時刻を修正できます。"}
              </p>
              {breakInput}
              <p className="text-sm font-semibold text-foreground">実働 {(liveComputedMinutes / 60).toFixed(1)} 時間</p>
              {hasInvalidTimeRange ? (
                <p className="text-xs text-red-600">退勤時刻が出勤時刻より前になっています。時刻を見直してください。</p>
              ) : null}
              {workplaceInput}
              {taskNameInput}
              {commentInput}
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <button
                type="button"
                disabled={pending || !clockInEdit || !clockOutEdit || hasInvalidTimeRange}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await submitWorkReportAction({
                        shiftId: shift.id,
                        outcome: "WORKED",
                        comment: comment || undefined,
                        taskName: taskName.trim() || undefined,
                        breakMinutes: Number(breakMinutes) || 0,
                        clockInTime: clockInEdit,
                        clockOutTime: clockOutEdit,
                        ...(workplaceChanged ? { companyRelationshipId: workplaceId || null } : {}),
                      });
                      showToast(editing ? "業務報告を修正しました ✓" : "業務報告を提出しました ✓");
                      setEditing(false);
                    } catch {
                      setError("提出に失敗しました。");
                    }
                  })
                }
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                {editing ? "修正して提出する" : "業務報告を提出する"}
              </button>
              {editing ? (
                <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted underline">
                  修正をやめる
                </button>
              ) : null}
            </div>
          )}

          {!readyToSubmit ? (
            <div className="mt-2 flex gap-3 text-xs text-muted">
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmOutcome("ABSENT")}
                className="underline"
              >
                欠勤
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmOutcome("CANCELLED_BY_EMPLOYER")}
                className="underline"
              >
                勤務先からのキャンセル
              </button>
            </div>
          ) : null}

          {confirmOutcome ? (
            <ConfirmDialog
              message={
                confirmOutcome === "ABSENT"
                  ? "欠勤として報告します。後から取り消せません。よろしいですか？"
                  : "勤務先からのキャンセルとして報告します。後から取り消せません。よろしいですか？"
              }
              confirmLabel="報告する"
              pending={pending}
              onConfirm={() => {
                const outcome = confirmOutcome;
                setConfirmOutcome(null);
                startTransition(() => submitWorkReportAction({ shiftId: shift.id, outcome }));
              }}
              onCancel={() => setConfirmOutcome(null)}
            />
          ) : null}
        </>
      )}
    </li>
  );
}

// 前日以前の未提出の業務報告を、一覧でまとめて提出する。時刻はシフトの予定時刻を最初から入れておき
// （時間未定は空欄）、違う日だけ直す。チェックを外した日（欠勤など）は報告せずに残す
function BulkReportModal({ shifts, onClose }: { shifts: ShiftRow[]; onClose: () => void }) {
  // 各行の扱い：出勤（時刻を入れて報告）／欠勤／勤務先キャンセル／あとで（報告せずに残す）
  type Kind = "WORKED" | "ABSENT" | "CANCELLED_BY_EMPLOYER" | "LATER";
  type Row = { shiftId: string; kind: Kind; clockIn: string; clockOut: string; breakMinutes: string };
  const [rows, setRows] = useState<Row[]>(() =>
    [...shifts]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({
        shiftId: s.id,
        kind: "WORKED" as Kind,
        clockIn: s.clockInTime ?? s.startTime ?? "",
        clockOut: s.clockOutTime ?? s.endTime ?? "",
        breakMinutes: String(s.breakMinutes || 0),
      })),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 「全部の日を同じ時間にする」：1回入れて、出勤の行すべてに反映する
  const [allIn, setAllIn] = useState("");
  const [allOut, setAllOut] = useState("");
  const [allBreak, setAllBreak] = useState("0");
  const allInvalid = !allIn || !allOut || allOut <= allIn;
  function applyToAll() {
    setRows((prev) =>
      prev.map((r) => (r.kind === "WORKED" ? { ...r, clockIn: allIn, clockOut: allOut, breakMinutes: allBreak } : r)),
    );
  }
  const byId = new Map(shifts.map((s) => [s.id, s]));
  const update = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const included = rows.filter((r) => r.kind !== "LATER");
  const invalid = included.some((r) => r.kind === "WORKED" && (!r.clockIn || !r.clockOut || r.clockOut <= r.clockIn));
  const countOf = (k: Kind) => rows.filter((r) => r.kind === k).length;
  const submitLabel = [
    countOf("WORKED") ? `出勤${countOf("WORKED")}件` : "",
    countOf("ABSENT") ? `欠勤${countOf("ABSENT")}件` : "",
    countOf("CANCELLED_BY_EMPLOYER") ? `キャンセル${countOf("CANCELLED_BY_EMPLOYER")}件` : "",
  ]
    .filter(Boolean)
    .join("・");

  function submitAll() {
    setError(null);
    startTransition(async () => {
      let ok = 0;
      for (const r of included) {
        try {
          if (r.kind === "WORKED") {
            await submitWorkReportAction({
              shiftId: r.shiftId,
              outcome: "WORKED",
              taskName: byId.get(r.shiftId)?.taskName ?? undefined,
              breakMinutes: Number(r.breakMinutes) || 0,
              clockInTime: r.clockIn,
              clockOutTime: r.clockOut,
            });
          } else {
            await submitWorkReportAction({ shiftId: r.shiftId, outcome: r.kind as "ABSENT" | "CANCELLED_BY_EMPLOYER" });
          }
          ok += 1;
        } catch {
          setError(`${ok}件提出しました。残りは提出できませんでした。もう一度お試しください。`);
          return;
        }
      }
      showToast(`${ok}件の業務報告を提出しました ✓`);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-3" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        data-testid="bulk-report"
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">まとめて報告</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-muted">
          予定の時刻が入っています。時間がそろっている時は下の「全部の日を同じ時間にする」が便利です。欠勤・勤務先キャンセルは▼で選べます（「あとで」は報告せずに残します）。
        </p>
        <div className="mb-3 rounded-xl bg-background p-2.5 text-xs" data-testid="bulk-report-all">
          <p className="mb-1.5 font-semibold text-primary">全部の日を同じ時間にする</p>
          <div className="grid grid-cols-3 gap-1.5">
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">出勤</span>
              <input type="time" value={allIn} onChange={(e) => setAllIn(e.target.value)} className="rounded-lg border border-border bg-white px-1.5 py-1" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">退勤</span>
              <input type="time" value={allOut} onChange={(e) => setAllOut(e.target.value)} className="rounded-lg border border-border bg-white px-1.5 py-1" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">休憩（分）</span>
              <input
                type="number"
                min={0}
                value={allBreak}
                onChange={(e) => setAllBreak(e.target.value)}
                className="rounded-lg border border-border bg-white px-1.5 py-1"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={allInvalid}
            onClick={applyToAll}
            className="mt-2 w-full rounded-lg border border-primary bg-white px-3 py-1.5 font-semibold text-primary disabled:opacity-50"
            data-testid="bulk-report-apply-all"
          >
            全部に反映
          </button>
        </div>
        <ul className="-mx-1 flex flex-1 flex-col gap-2 overflow-y-auto px-1">
          {rows.map((r, i) => {
            const s = byId.get(r.shiftId)!;
            const dt = new Date(`${s.date}T00:00:00Z`);
            const wd = ["日", "月", "火", "水", "木", "金", "土"][dt.getUTCDay()];
            return (
              <li
                key={r.shiftId}
                className={`rounded-xl border p-2.5 text-xs ${r.kind === "LATER" ? "border-dashed border-border opacity-60" : "border-border"}`}
                data-testid="bulk-report-row"
              >
                <div className={`flex items-center justify-between gap-2 ${r.kind === "WORKED" ? "mb-1.5" : ""}`}>
                  <span className="min-w-0 truncate font-semibold">
                    {dt.getUTCMonth() + 1}月{dt.getUTCDate()}日（{wd}）{s.workplaceName ?? s.companyName}
                  </span>
                  <select
                    value={r.kind}
                    onChange={(e) => update(i, { kind: e.target.value as Kind })}
                    className="shrink-0 rounded-lg border border-border bg-white px-1.5 py-1 text-xs"
                    data-testid="bulk-report-kind"
                  >
                    <option value="WORKED">出勤</option>
                    <option value="ABSENT">欠勤</option>
                    <option value="CANCELLED_BY_EMPLOYER">勤務先キャンセル</option>
                    <option value="LATER">あとで</option>
                  </select>
                </div>
                {r.kind === "WORKED" ? (
                  <>
                    {i > 0 ? (
                      <div className="mb-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            update(i, {
                              clockIn: rows[i - 1].clockIn,
                              clockOut: rows[i - 1].clockOut,
                              breakMinutes: rows[i - 1].breakMinutes,
                            })
                          }
                          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-primary"
                        >
                          上の行と同じ
                        </button>
                      </div>
                    ) : null}
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-muted">出勤</span>
                    <input
                      type="time"
                      value={r.clockIn}
                     
                      onChange={(e) => update(i, { clockIn: e.target.value })}
                      className="rounded-lg border border-border px-1.5 py-1"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-muted">退勤</span>
                    <input
                      type="time"
                      value={r.clockOut}
                     
                      onChange={(e) => update(i, { clockOut: e.target.value })}
                      className="rounded-lg border border-border px-1.5 py-1"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-muted">休憩（分）</span>
                    <input
                      type="number"
                      min={0}
                      value={r.breakMinutes}
                     
                      onChange={(e) => update(i, { breakMinutes: e.target.value })}
                      className="rounded-lg border border-border px-1.5 py-1"
                    />
                  </label>
                </div>
                    {!r.clockIn || !r.clockOut ? <p className="mt-1 text-red-600">出勤・退勤の時刻を入れてください。</p> : null}
                    {r.clockIn && r.clockOut && r.clockOut <= r.clockIn ? (
                      <p className="mt-1 text-red-600">退勤時刻が出勤時刻より前になっています。</p>
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
        {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        <button
          type="button"
          disabled={pending || included.length === 0 || invalid}
          onClick={submitAll}
          className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
          data-testid="bulk-report-submit"
        >
          {pending ? "提出中…" : included.length > 0 ? `${submitLabel}を提出` : "提出するものがありません"}
        </button>
      </div>
    </div>
  );
}

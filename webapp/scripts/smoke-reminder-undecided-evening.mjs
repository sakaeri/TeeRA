import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// 通知のリマインドを検証する（テスト用に現在時刻を指定してCronの受付口を叩く）：
// ・時間「未定」のシフトにも、当日朝6時以降に朝のリマインドが届く（以前は届かなかった）
// ・当日20時を過ぎても業務報告が出ていなければ、プッシュ通知で知らせる（メールは送らない）
//   （退勤の打刻を忘れた日も対象。まだ勤務中・提出済みのシフトは対象外。1回だけ）
// ・未提出のプッシュは「退勤3時間後」と「20時」のどちらか1回だけ

const CRON_SECRET = "local-dev-cron-secret-not-for-production";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}
const logSize = () => readFileSync("/tmp/nextdev.log").length;
const logSince = (offset) => readFileSync("/tmp/nextdev.log").subarray(offset).toString();

const suffix = Date.now();
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const at = (hhmm) => encodeURIComponent(`${today}T${hhmm}:00+09:00`);
const callCron = async (hhmm) => {
  const res = await fetch(`http://localhost:3000/api/cron/notifications?job=shift-start-reminders&now=${at(hhmm)}`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  return res.status;
};

const companyId = psql(
  `with ins as (insert into "Company" (id, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'リマインド確認株式会社${suffix}', now(), now()) returning id) select id from ins;`,
);
const staffEmail = `reminder-staff-${suffix}@example.com`;
const staffId = psql(
  `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', 'x', 'リマインド確認スタッフ', now()) returning id) select id from ins;`,
);
psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
// 届かない宛先のプッシュ購読（送ろうとすると失敗のログに宛先が出るので、送ったかどうかを確かめられる）
const pushEndpoint = `https://push.invalid/reminder-${suffix}`;
psql(
  `insert into "PushSubscription" (id, "userId", endpoint, p256dh, auth) values (gen_random_uuid()::text, '${staffId}', '${pushEndpoint}', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');`,
);
const shift = (extra) =>
  psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', 'キャディ', '${today}', ${extra}, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
// 時間未定のシフト（出勤・退勤は打刻したが、業務報告は未提出）
const undecidedId = shift(`null, null, false, true`);
psql(
  `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${undecidedId}', '${staffId}', 'WORKED', 'PENDING', now() - interval '9 hours', now() - interval '2 hours', 420, now(), now());`,
);
// まだ勤務中（終了予定23:00）のシフト
const lateId = shift(`'18:00', '23:00', false, false`);
// 提出済みのシフト
const submittedId = shift(`'08:00', '12:00', false, false`);
psql(
  `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${submittedId}', '${staffId}', 'WORKED', 'PENDING', 240, now(), now(), now());`,
);
// 別のスタッフ：15時前に退勤（＝20時より前に「退勤3時間後」が送られる）
const staff2Id = psql(
  `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'reminder-staff2-${suffix}@example.com', 'x', 'リマインド確認スタッフ2', now()) returning id) select id from ins;`,
);
psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staff2Id}', '${companyId}', 'STAFF');`);
const push2Endpoint = `https://push.invalid/reminder2-${suffix}`;
psql(
  `insert into "PushSubscription" (id, "userId", endpoint, p256dh, auth) values (gen_random_uuid()::text, '${staff2Id}', '${push2Endpoint}', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');`,
);
const earlyId = psql(
  `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staff2Id}', 'INHOUSE', 'キャディ', '${today}', null, null, false, true, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
);
psql(
  `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${earlyId}', '${staff2Id}', 'WORKED', 'PENDING', now() - interval '12 hours', now() - interval '4 hours', 420, now(), now());`,
);
const sentAt = (id, col) => psql(`select coalesce("${col}"::text, '') from "Shift" where id='${id}';`);

const runStartOffset = logSize();
// --- 朝のリマインド ---
log("リマインドのジョブが動く", (await callCron("05:30")) === 200);
log("時間未定のシフトは6時前にはまだ送らない", sentAt(undecidedId, "reminderSentAt") === "");
let offset = logSize();
await callCron("06:10");
log("時間未定のシフトにも6時を過ぎたら朝のリマインドを送る", sentAt(undecidedId, "reminderSentAt") !== "");
log("朝のリマインドのメールが本人に送られる", logSince(offset).includes(`宛先=${staffEmail}`));

// --- 20時の業務報告リマインド ---
await callCron("19:50");
log("20時前は業務報告のリマインドを送らない", sentAt(undecidedId, "reportReminderSentAt") === "");
offset = logSize();
await callCron("20:10");
const mailLog = logSince(offset);
log("20時を過ぎて未提出のシフトにリマインドを送る（退勤3時間後とは別）", sentAt(undecidedId, "reportReminderSentAt") !== "");
log("本人にプッシュ通知を送る", mailLog.includes(pushEndpoint));
log("メールは送らない（未提出のメールは週1回のまとめだけ）", !mailLog.includes(`宛先=${staffEmail} 件名=【TeeRA】今日の業務報告`));
log("まだ勤務中（終了予定が今より後）のシフトは対象外", sentAt(lateId, "reportReminderSentAt") === "");
log("提出済みのシフトは対象外", sentAt(submittedId, "reportReminderSentAt") === "");
const first = sentAt(undecidedId, "reportReminderSentAt");
offset = logSize();
await callCron("20:15");
log(
  "2回目は送らない",
  sentAt(undecidedId, "reportReminderSentAt") === first &&
    !logSince(offset).includes(pushEndpoint),
);

// --- 未提出のプッシュは1回だけ ---
const count = (text, needle) => text.split(needle).length - 1;
log(
  "「退勤3時間後」を送ったシフトには20時のプッシュを送らない（1回だけ）",
  psql(`select ("submitReminderSentAt" is not null)::text from "WorkReport" where "shiftId"='${earlyId}';`) === "true" &&
    count(mailLog, push2Endpoint) === 0,
);
// 20時のプッシュを送ったシフトが、そのあと「退勤3時間後」の条件を満たしても送らない
psql(`update "WorkReport" set "clockOut" = now() - interval '4 hours' where "shiftId"='${undecidedId}';`);
offset = logSize();
await callCron("20:20");
log(
  "20時のプッシュを送ったシフトには、あとから「退勤3時間後」を送らない（1回だけ）",
  psql(`select ("submitReminderSentAt" is null)::text from "WorkReport" where "shiftId"='${undecidedId}';`) === "true" &&
    !logSince(offset).includes(pushEndpoint),
);

console.log(process.exitCode ? "REMINDER UNDECIDED/EVENING SMOKE TEST HAD FAILURES" : "REMINDER UNDECIDED/EVENING SMOKE TEST PASSED");

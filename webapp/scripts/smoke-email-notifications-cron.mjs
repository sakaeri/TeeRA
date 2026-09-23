import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  // "returning ..."句を使うINSERT/UPDATEでは、-t -Aでも返り値の行の後ろに
  // "INSERT 0 1"等のコマンド完了タグが追加で出力される。呼び出し側が
  // 単一値だけを期待できるよう、その行は取り除いておく。
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}

const DEV_LOG_PATH = "/tmp/nextdev.log";
function readServerLogSince(startSize) {
  return readFileSync(DEV_LOG_PATH, "utf8").slice(startSize);
}
const CRON_SECRET = "local-dev-cron-secret-not-for-production";
async function callCron(job, secret = CRON_SECRET) {
  return fetch(`http://localhost:3000/api/cron/notifications?job=${job}`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
}

try {
  // 認証まわり
  const noAuthRes = await callCron("shift-request-digest", null);
  log("Authorizationヘッダ無しは401", noAuthRes.status === 401);

  const wrongAuthRes = await callCron("shift-request-digest", "wrong-secret");
  log("誤ったシークレットは401", wrongAuthRes.status === 401);

  const badJobRes = await fetch("http://localhost:3000/api/cron/notifications?job=unknown", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  log("未知のjobは400", badJobRes.status === 400);

  // ②シフト希望のたまり（しきい値なし、1件でも通知）
  const suffix = Date.now();
  const digestAdminEmail = `cron-digest-admin-${suffix}@example.com`;
  const digestCompanyName = `Cronダイジェストテスト${suffix}`;
  const digestNotifyEmail = `cron-notify-${suffix}@example.com`;

  const digestUserId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${digestAdminEmail}', 'x', 'Cron管理者', now()) returning id;`,
  );
  const digestCompanyId = psql(
    `insert into "Company" (id, name, "notificationEmail", "updatedAt") values (gen_random_uuid()::text, '${digestCompanyName}', '${digestNotifyEmail}', now()) returning id;`,
  );
  psql(
    `insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${digestUserId}', '${digestCompanyId}', 'COMPANY_ADMIN');`,
  );
  const digestStaffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'cron-digest-staff-${suffix}@example.com', 'x', 'Cron希望者', now()) returning id;`,
  );
  psql(
    `insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) ` +
      `values (gen_random_uuid()::text, '${digestStaffId}', '${digestCompanyId}', 'WORK', ARRAY[current_date + 3]::date[], 'PENDING');`,
  );

  let logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  const digestRes = await callCron("shift-request-digest");
  await new Promise((r) => setTimeout(r, 500));
  log("shift-request-digestは200", digestRes.status === 200);
  const digestLog = readServerLogSince(logStart);
  log(
    "1件でもPENDINGのシフト希望があれば通知される（しきい値なし）",
    digestLog.includes(digestNotifyEmail) && digestLog.includes("未確定のシフト希望") && digestLog.includes("1件"),
  );

  // ④勤務開始1時間前リマインド
  const reminderCompanyName = `Cronリマインドテスト${suffix}`;
  const reminderCompanyId = psql(
    `insert into "Company" (id, name, "updatedAt") values (gen_random_uuid()::text, '${reminderCompanyName}', now()) returning id;`,
  );
  const reminderStaffEmail = `cron-reminder-staff-${suffix}@example.com`;
  const reminderStaffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${reminderStaffEmail}', 'x', 'Cronリマインド太郎', now()) returning id;`,
  );
  // 今からちょうど1時間後の時刻をHH:MM（JST）で計算してシフトを用意する
  const inOneHour = new Date(Date.now() + 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
  const hh = String(inOneHour.getUTCHours()).padStart(2, "0");
  const mm = String(inOneHour.getUTCMinutes()).padStart(2, "0");
  const reminderShiftId = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', '${reminderStaffId}', 'INHOUSE', (now() at time zone 'Asia/Tokyo')::date, '${hh}:${mm}', '${hh}:${mm}', 'ASSIGN', now()) returning id;`,
  );

  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  const reminderRes = await callCron("shift-start-reminders");
  await new Promise((r) => setTimeout(r, 500));
  log("shift-start-remindersは200", reminderRes.status === 200);
  const reminderLog = readServerLogSince(logStart);
  log("1時間後開始のシフトにリマインドメールが送られる", reminderLog.includes(reminderStaffEmail) && reminderLog.includes("まもなくシフトの時間です"));

  const remindedAt = psql(`select "reminderSentAt" is not null from "Shift" where id='${reminderShiftId}';`);
  log("送信済みフラグ(reminderSentAt)が立つ", remindedAt === "t");

  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  await callCron("shift-start-reminders");
  await new Promise((r) => setTimeout(r, 300));
  const secondReminderLog = readServerLogSince(logStart);
  log("同じシフトに二重送信されない", !secondReminderLog.includes(reminderStaffEmail));

  // ⑤未提出の業務報告・契約書同意待ちリマインド（週次、スタッフ本人宛）
  const weeklyStaffEmail = `cron-weekly-staff-${suffix}@example.com`;
  const weeklyStaffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${weeklyStaffEmail}', 'x', 'Cron週次太郎', now()) returning id;`,
  );
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', '${weeklyStaffId}', 'INHOUSE', current_date - 2, '09:00', '17:00', 'CONFIRMED', 'ASSIGN', now());`,
  );

  const templateId = psql(
    `insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "paymentClosingDay", "paymentDay", "paymentMethod", "contractPeriodType", "contractStartDate", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', 'Cronテスト契約', 'PART_TIME', 'INHOUSE', 'テスト業務', 'FIXED', 'HOURLY', 1200, '末日', '翌月10日', '振込', 'INDEFINITE', current_date, 'LOCKED', now(), now()) returning id;`,
  );
  psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateId}', '${weeklyStaffId}', 1200, 'PENDING_CONSENT', now(), now());`,
  );

  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  const weeklyRes = await callCron("weekly-digest");
  await new Promise((r) => setTimeout(r, 500));
  log("weekly-digestは200", weeklyRes.status === 200);
  const weeklyLog = readServerLogSince(logStart);
  log("未提出の業務報告リマインドがスタッフ本人に届く", weeklyLog.includes(weeklyStaffEmail) && weeklyLog.includes("未提出の業務報告"));
  log("契約書の同意待ちリマインドがスタッフ本人に届く", weeklyLog.includes(weeklyStaffEmail) && weeklyLog.includes("契約書の確認"));

  console.log(process.exitCode ? "EMAIL NOTIFICATIONS CRON SMOKE TEST HAD FAILURES" : "EMAIL NOTIFICATIONS CRON SMOKE TEST PASSED");
} catch (err) {
  console.error("EMAIL NOTIFICATIONS CRON SMOKE TEST FAILED", err);
  process.exitCode = 1;
}

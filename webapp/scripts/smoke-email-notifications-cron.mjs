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
  log("会社宛メールには個人名でなく会社名に「御中」が付く", digestLog.includes(digestCompanyName) && digestLog.includes("御中"));

  // ④勤務開始リマインド — GitHub Actionsの"*/5"スケジュールは実際には
  // 数時間おきにしか実行されないことがあるため、「ちょうど1時間前」の狭い
  // 窓ではなく「開始4時間前〜開始2時間後」の幅を持たせている
  // （emailNotifications.tsのrunShiftStartReminders参照）。
  function jstHHMMAfter(msFromNow) {
    const t = new Date(Date.now() + msFromNow + 9 * 60 * 60 * 1000);
    return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
  }
  const reminderCompanyName = `Cronリマインドテスト${suffix}`;
  const reminderCompanyId = psql(
    `insert into "Company" (id, name, "updatedAt") values (gen_random_uuid()::text, '${reminderCompanyName}', now()) returning id;`,
  );
  const reminderStaffEmail = `cron-reminder-staff-${suffix}@example.com`;
  const reminderStaffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${reminderStaffEmail}', 'x', 'Cronリマインド太郎', now()) returning id;`,
  );
  const hhmm = jstHHMMAfter(60 * 60 * 1000);
  const reminderShiftId = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "taskName", "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', '${reminderStaffId}', 'INHOUSE', (now() at time zone 'Asia/Tokyo')::date, '${hhmm}', '${hhmm}', 'リマインド確認業務', 'ASSIGN', now()) returning id;`,
  );

  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  const reminderRes = await callCron("shift-start-reminders");
  await new Promise((r) => setTimeout(r, 500));
  log("shift-start-remindersは200", reminderRes.status === 200);
  const reminderLog = readServerLogSince(logStart);
  log(
    "1時間後開始のシフトにリマインドメールが送られる",
    reminderLog.includes(reminderStaffEmail) &&
      reminderLog.includes("まもなくシフトの時間です") &&
      reminderLog.includes("の時間が近づいています"),
  );
  log("リマインドメールに宛名（○○様）が入る", reminderLog.includes("Cronリマインド太郎様"));
  log("リマインドメールに勤務先が入る", reminderLog.includes("勤務先：") && reminderLog.includes(reminderCompanyName));
  log("リマインドメールに業務内容が入る", reminderLog.includes("業務内容：") && reminderLog.includes("リマインド確認業務"));
  log("リマインドメールのボタンが「タイムカードを開く」になっている", reminderLog.includes("タイムカードを開く"));
  log("リマインドメールがアプリの配色（濃い緑・金）を使っている", reminderLog.includes("#0b3d2e") && reminderLog.includes("#c9a24b"));

  const remindedAt = psql(`select "reminderSentAt" is not null from "Shift" where id='${reminderShiftId}';`);
  log("送信済みフラグ(reminderSentAt)が立つ", remindedAt === "t");

  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  await callCron("shift-start-reminders");
  await new Promise((r) => setTimeout(r, 300));
  const secondReminderLog = readServerLogSince(logStart);
  log("同じシフトに二重送信されない", !secondReminderLog.includes(reminderStaffEmail));

  // Cronが数時間遅れて実行されても取りこぼさないよう窓を広げた分の検証:
  // 開始3.5時間前（窓の中）は送られ、開始5時間前（窓の外）はまだ送られない。
  const wideWindowStaffEmail = `cron-reminder-wide-staff-${suffix}@example.com`;
  const wideWindowStaffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${wideWindowStaffEmail}', 'x', 'Cron広窓太郎', now()) returning id;`,
  );
  const withinWideWindowHHMM = jstHHMMAfter(3.5 * 60 * 60 * 1000);
  const withinWideWindowShiftId = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', '${wideWindowStaffId}', 'INHOUSE', (now() at time zone 'Asia/Tokyo')::date, '${withinWideWindowHHMM}', '${withinWideWindowHHMM}', 'ASSIGN', now()) returning id;`,
  );
  const tooEarlyStaffEmail = `cron-reminder-tooearly-staff-${suffix}@example.com`;
  const tooEarlyStaffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${tooEarlyStaffEmail}', 'x', 'Cron早すぎ太郎', now()) returning id;`,
  );
  const tooEarlyHHMM = jstHHMMAfter(5 * 60 * 60 * 1000);
  const tooEarlyShiftId = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', '${tooEarlyStaffId}', 'INHOUSE', (now() at time zone 'Asia/Tokyo')::date, '${tooEarlyHHMM}', '${tooEarlyHHMM}', 'ASSIGN', now()) returning id;`,
  );

  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  await callCron("shift-start-reminders");
  await new Promise((r) => setTimeout(r, 500));
  const wideWindowLog = readServerLogSince(logStart);
  log("開始3.5時間前（広げた窓の中）でもリマインドが送られる", wideWindowLog.includes(wideWindowStaffEmail));
  log("開始5時間前（窓の外）はまだ送られない", !wideWindowLog.includes(tooEarlyStaffEmail));
  const tooEarlyReminded = psql(`select "reminderSentAt" is not null from "Shift" where id='${tooEarlyShiftId}';`);
  log("開始5時間前のシフトのreminderSentAtはまだ立たない", tooEarlyReminded === "f");
  const withinWideWindowReminded = psql(
    `select "reminderSentAt" is not null from "Shift" where id='${withinWideWindowShiftId}';`,
  );
  log("開始3.5時間前のシフトのreminderSentAtが立つ", withinWideWindowReminded === "t");

  // 終日シフトは「開始◯時間前」の基準が使えないため、当日朝6:00以降なら
  // Cronの実行タイミングに関わらずいつでもリマインドする（6:00ちょうどの
  // 狭い窓に固定しない）。テスト実行時刻が朝6:00より前か後かで期待値を
  // 出し分ける。
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const jstMinutesOfDay = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();
  const isPastSixAm = jstMinutesOfDay >= 6 * 60;

  const allDayStaffEmail = `cron-reminder-allday-staff-${suffix}@example.com`;
  const allDayStaffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${allDayStaffEmail}', 'x', 'Cron終日太郎', now()) returning id;`,
  );
  const allDayShiftId = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "isAllDay", "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', '${allDayStaffId}', 'INHOUSE', (now() at time zone 'Asia/Tokyo')::date, true, 'ASSIGN', now()) returning id;`,
  );
  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  await callCron("shift-start-reminders");
  await new Promise((r) => setTimeout(r, 300));
  const allDayLog = readServerLogSince(logStart);
  if (isPastSixAm) {
    log("終日シフトは朝6:00以降ならCronの実行タイミングに関わらず送られる", allDayLog.includes(allDayStaffEmail));
    const allDayReminded = psql(`select "reminderSentAt" is not null from "Shift" where id='${allDayShiftId}';`);
    log("終日シフトのreminderSentAtが立つ", allDayReminded === "t");
  } else {
    log("終日シフトは朝6:00より前は送られない", !allDayLog.includes(allDayStaffEmail));
    const allDayReminded = psql(`select "reminderSentAt" is not null from "Shift" where id='${allDayShiftId}';`);
    log("終日シフトのreminderSentAtは立っていない", allDayReminded === "f");
  }

  // 公開募集経由のシフトには、募集時の服装・持ち物等の詳細もリマインド
  // メールに載る。
  const recruitStaffEmail = `cron-reminder-recruit-staff-${suffix}@example.com`;
  const recruitStaffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${recruitStaffEmail}', 'x', 'Cron募集太郎', now()) returning id;`,
  );
  const recruitHHMM = jstHHMMAfter(60 * 60 * 1000);
  const recruitmentId = psql(
    `with ins as (insert into "PublicRecruitment" (id, "companyId", title, note, "extraItems", date, "startTime", "endTime", "maxEntries", "lockedTee", status, visibility, "publishedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', 'Cron募集確認', '動きやすい服装でお越しください', '[{"label":"持ち物","value":"タオル・飲み物"}]'::jsonb, (now() at time zone 'Asia/Tokyo')::date, '${recruitHHMM}', '${recruitHHMM}', 1, 0, 'PUBLISHED', 'ORDER', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "taskName", "publicRecruitmentId", "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', '${recruitStaffId}', 'INHOUSE', (now() at time zone 'Asia/Tokyo')::date, '${recruitHHMM}', '${recruitHHMM}', '募集経由業務', '${recruitmentId}', 'ASSIGN', now());`,
  );
  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  await callCron("shift-start-reminders");
  await new Promise((r) => setTimeout(r, 500));
  const recruitLog = readServerLogSince(logStart);
  log("公開募集経由のシフトのリマインドに募集時の詳細（服装）が入る", recruitLog.includes("動きやすい服装でお越しください"));
  log("公開募集経由のシフトのリマインドに募集時の詳細（持ち物）が入る", recruitLog.includes("持ち物") && recruitLog.includes("タオル・飲み物"));

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

  // 仮アカウント（isProxy=true、本物のメールアドレスを持たない）には
  // 週次リマインドが送られないこと（送ろうとしても宛先proxy.teera.internal
  // が実在しないため確実にバウンスする）も合わせて確認する。
  const weeklyProxyId = psql(
    `insert into "User" (id, email, "passwordHash", name, "isProxy", "updatedAt") ` +
      `values (gen_random_uuid()::text, 'cron-weekly-proxy-${suffix}@proxy.teera.internal', 'x', 'Cron週次仮太郎', true, now()) returning id;`,
  );
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${reminderCompanyId}', '${weeklyProxyId}', 'INHOUSE', current_date - 2, '09:00', '17:00', 'CONFIRMED', 'ASSIGN', now());`,
  );
  psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateId}', '${weeklyProxyId}', 1200, 'PENDING_CONSENT', now(), now());`,
  );

  logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  const weeklyRes = await callCron("weekly-digest");
  await new Promise((r) => setTimeout(r, 500));
  log("weekly-digestは200", weeklyRes.status === 200);
  const weeklyLog = readServerLogSince(logStart);
  log("未提出の業務報告リマインドがスタッフ本人に届く", weeklyLog.includes(weeklyStaffEmail) && weeklyLog.includes("未提出の業務報告"));
  log("契約書の同意待ちリマインドがスタッフ本人に届く", weeklyLog.includes(weeklyStaffEmail) && weeklyLog.includes("契約書の確認"));
  log("週次リマインドにも宛名（○○様）が入る", weeklyLog.includes("Cron週次太郎様"));
  log("仮アカウントには未提出業務報告・契約同意の週次リマインドが送られない", !weeklyLog.includes("proxy.teera.internal"));

  console.log(process.exitCode ? "EMAIL NOTIFICATIONS CRON SMOKE TEST HAD FAILURES" : "EMAIL NOTIFICATIONS CRON SMOKE TEST PASSED");
} catch (err) {
  console.error("EMAIL NOTIFICATIONS CRON SMOKE TEST FAILED", err);
  process.exitCode = 1;
}

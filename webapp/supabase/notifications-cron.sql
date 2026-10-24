-- TeeRAの通知（シフト開始リマインド・業務報告の未提出リマインドなど）を、
-- SupabaseのCron（pg_cron）から5分おきに動かす設定。
-- GitHub Actionsの無料枠の定期実行は混雑時に数時間おきまで間引かれ、
-- リマインドが届かない原因になっていたため、こちらを本番の時計にする。
--
-- 使い方（1回だけ）：Supabaseのダッシュボード → SQL Editor にこのファイルを
-- 丸ごと貼り付け、下の2か所を書き換えてから「Run」を押す。
--   ・<APP_URL>      本番のURL（例：https://teera-tau.vercel.app）。最後の / は付けない
--   ・<CRON_SECRET>  Vercelの環境変数 CRON_SECRET と同じ値
-- 何度実行しても同じ状態になる（同じ名前の予定は上書きされる）。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- CRON_SECRETはSQLの本文に残さないよう、Vaultに暗号化して保存する
do $$
begin
  if exists (select 1 from vault.secrets where name = 'teera_cron_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'teera_cron_secret'),
      '<CRON_SECRET>'
    );
  else
    perform vault.create_secret('<CRON_SECRET>', 'teera_cron_secret');
  end if;
end $$;

-- 5分おき：シフト開始リマインド、退勤3時間後・当日20時の業務報告リマインド
select cron.schedule(
  'teera-shift-start-reminders',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := '<APP_URL>/api/cron/notifications?job=shift-start-reminders',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'teera_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- 毎週月曜9:00（日本時間）＝月曜0:00（UTC）：未提出の業務報告・契約書の同意待ちのまとめメール
select cron.schedule(
  'teera-weekly-digest',
  '0 0 * * 1',
  $$
  select net.http_get(
    url := '<APP_URL>/api/cron/notifications?job=weekly-digest',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'teera_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- 確認用：登録された予定と、直近の実行結果（status_code が 200 なら成功）
-- select jobname, schedule, active from cron.job where jobname like 'teera-%';
-- select status_code, created from net._http_response order by created desc limit 10;

-- ログイン用マジックリンクでも、パスワードログインのfromパラメータと同様に
-- 「ログイン後にどこへ戻るか」を保持できるようにする（登録確認用の
-- inviteTokenとは別の汎用フィールド）。
ALTER TABLE "AccountActionToken" ADD COLUMN "redirectTo" TEXT;

-- 登録をマジックリンク方式に変更するための準備。
-- passwordHashは任意化（マジックリンクのみの人はnull）。
-- 既存ユーザーは全員パスワード設定済み・確認済み扱いにする（後方互換）。
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "emailVerified" = true;

ALTER TYPE "AccountActionTokenKind" ADD VALUE 'MAGIC_LINK';
ALTER TABLE "AccountActionToken" ADD COLUMN "inviteToken" TEXT;

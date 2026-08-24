-- 備考（常時表示の簡易メモ、PUBLIC限定の構造化項目とは別）と時刻未定フラグ
-- （Shift.isUndecidedと同じ考え方）を追加。オーダー作成フォームのプロトタイプ
-- 画面に合わせる。
ALTER TABLE "PublicRecruitment" ADD COLUMN "note" TEXT;
ALTER TABLE "PublicRecruitment" ADD COLUMN "isUndecided" BOOLEAN NOT NULL DEFAULT false;

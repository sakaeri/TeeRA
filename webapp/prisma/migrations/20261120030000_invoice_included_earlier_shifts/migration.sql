-- 依頼主への請求書に、前の月以前に請求していなかったシフトを入れた分（そのシフトのID）
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "includedEarlierShiftIds" JSONB NOT NULL DEFAULT '[]';

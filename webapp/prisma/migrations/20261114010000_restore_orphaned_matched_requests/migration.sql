-- シフト作成で重なり・休み希望の確認が出た時に、作りかけたシフトを消して戻していたが、
-- そのシフトで「対応済み」にしたシフト希望が戻らず消えていた不具合の後始末。
-- 対応済みなのに、対応したシフトが存在しないシフト希望を、まだ対応していない状態に戻す。
UPDATE "ShiftRequest" r
SET status = 'PENDING', "matchedShiftId" = NULL
WHERE r.status = 'MATCHED'
  AND r."matchedShiftId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Shift" s WHERE s.id = r."matchedShiftId");

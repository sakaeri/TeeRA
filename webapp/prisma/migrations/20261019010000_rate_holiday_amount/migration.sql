-- 土日祝の単価（null＝平日と同じ）
ALTER TABLE "CompanyPlacementRateVersion" ADD COLUMN "holidayAmount" INTEGER;
ALTER TABLE "StaffTaskRateVersion" ADD COLUMN "holidayAmount" INTEGER;

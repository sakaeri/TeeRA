-- 電子印の濃さ（不透明度%）
ALTER TABLE "Company" ADD COLUMN "sealOpacity" INTEGER NOT NULL DEFAULT 45;

ALTER TABLE "CompanyRelationship" RENAME COLUMN "staffSharedNote" TO "workLocation";
ALTER TABLE "CompanyRelationship" ADD COLUMN "emergencyContact" TEXT;
ALTER TABLE "RelationshipNote" ADD COLUMN "visibleToStaff" BOOLEAN NOT NULL DEFAULT false;

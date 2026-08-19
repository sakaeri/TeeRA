ALTER TABLE "InviteToken" ADD COLUMN "contractTemplateId" TEXT;
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_contractTemplateId_fkey" FOREIGN KEY ("contractTemplateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

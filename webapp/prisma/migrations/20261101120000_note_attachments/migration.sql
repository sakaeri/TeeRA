-- CreateTable
CREATE TABLE "NoteAttachment" (
    "id" TEXT NOT NULL,
    "staffNoteId" TEXT,
    "relationshipNoteId" TEXT,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteAttachment_staffNoteId_idx" ON "NoteAttachment"("staffNoteId");

-- CreateIndex
CREATE INDEX "NoteAttachment_relationshipNoteId_idx" ON "NoteAttachment"("relationshipNoteId");

-- AddForeignKey
ALTER TABLE "NoteAttachment" ADD CONSTRAINT "NoteAttachment_staffNoteId_fkey" FOREIGN KEY ("staffNoteId") REFERENCES "StaffNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteAttachment" ADD CONSTRAINT "NoteAttachment_relationshipNoteId_fkey" FOREIGN KEY ("relationshipNoteId") REFERENCES "RelationshipNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;


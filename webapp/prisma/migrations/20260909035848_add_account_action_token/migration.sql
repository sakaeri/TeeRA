-- CreateEnum
CREATE TYPE "AccountActionTokenKind" AS ENUM ('PASSWORD_RESET', 'EMAIL_CHANGE');

-- CreateTable
CREATE TABLE "AccountActionToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" "AccountActionTokenKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountActionToken_tokenHash_key" ON "AccountActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountActionToken_userId_idx" ON "AccountActionToken"("userId");

-- AddForeignKey
ALTER TABLE "AccountActionToken" ADD CONSTRAINT "AccountActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountActionToken" ENABLE ROW LEVEL SECURITY;

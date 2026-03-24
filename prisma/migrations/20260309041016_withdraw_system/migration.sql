-- CreateEnum
CREATE TYPE "WithdrawStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'CANCELED');

-- CreateTable
CREATE TABLE "WithdrawRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "method" TEXT NOT NULL,
    "accountInfo" JSONB,
    "status" "WithdrawStatus" NOT NULL DEFAULT 'PENDING',
    "amlRiskScore" INTEGER NOT NULL DEFAULT 0,
    "amlReason" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "payoutReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WithdrawRequest_userId_createdAt_idx" ON "WithdrawRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WithdrawRequest_walletId_createdAt_idx" ON "WithdrawRequest"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WithdrawRequest_status_createdAt_idx" ON "WithdrawRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "WithdrawRequest" ADD CONSTRAINT "WithdrawRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawRequest" ADD CONSTRAINT "WithdrawRequest_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

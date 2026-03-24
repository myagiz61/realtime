/*
  Warnings:

  - The `status` column on the `Hold` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[walletId,type,refType,refId]` on the table `LedgerEntry` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- AlterTable
ALTER TABLE "Hold" DROP COLUMN "status",
ADD COLUMN     "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Hold_walletId_status_idx" ON "Hold"("walletId", "status");

-- CreateIndex
CREATE INDEX "Hold_roomId_status_idx" ON "Hold"("roomId", "status");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_createdAt_idx" ON "LedgerEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_refType_refId_idx" ON "LedgerEntry"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_walletId_type_refType_refId_key" ON "LedgerEntry"("walletId", "type", "refType", "refId");

-- CreateIndex
CREATE INDEX "Room_status_createdAt_idx" ON "Room"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

/*
  Warnings:

  - Changed the type of `refType` on the `LedgerEntry` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "LedgerRefType" AS ENUM ('DEPOSIT', 'WITHDRAW', 'ROOM', 'GAME', 'ADMIN');

-- AlterTable
ALTER TABLE "LedgerEntry" DROP COLUMN "refType",
ADD COLUMN     "refType" "LedgerRefType" NOT NULL;

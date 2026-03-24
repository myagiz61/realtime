/*
  Warnings:

  - The primary key for the `RoomPlayer` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `RoomPlayer` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "RoomPlayer" DROP CONSTRAINT "RoomPlayer_roomId_fkey";

-- DropIndex
DROP INDEX "RoomPlayer_roomId_userId_key";

-- AlterTable
ALTER TABLE "RoomPlayer" DROP CONSTRAINT "RoomPlayer_pkey",
DROP COLUMN "id",
ADD COLUMN     "disconnectedAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD CONSTRAINT "RoomPlayer_pkey" PRIMARY KEY ("roomId", "userId");

-- CreateIndex
CREATE INDEX "RoomPlayer_userId_idx" ON "RoomPlayer"("userId");

-- CreateIndex
CREATE INDEX "RoomPlayer_roomId_disconnectedAt_idx" ON "RoomPlayer"("roomId", "disconnectedAt");

-- AddForeignKey
ALTER TABLE "RoomPlayer" ADD CONSTRAINT "RoomPlayer_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

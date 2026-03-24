-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('WAITING', 'PLAYING', 'FINISHED', 'CANCELED');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "stake" DECIMAL(65,30) NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomPlayer" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Room_gameType_stake_status_idx" ON "Room"("gameType", "stake", "status");

-- CreateIndex
CREATE INDEX "RoomPlayer_roomId_idx" ON "RoomPlayer"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomPlayer_roomId_userId_key" ON "RoomPlayer"("roomId", "userId");

-- AddForeignKey
ALTER TABLE "RoomPlayer" ADD CONSTRAINT "RoomPlayer_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

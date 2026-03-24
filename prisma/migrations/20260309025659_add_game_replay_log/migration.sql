-- CreateTable
CREATE TABLE "GameReplayLog" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "userId" TEXT,
    "seat" INTEGER,
    "eventType" TEXT NOT NULL,
    "actionType" TEXT,
    "phase" TEXT,
    "turnIndex" INTEGER,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameReplayLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameReplayLog_roomId_createdAt_idx" ON "GameReplayLog"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "GameReplayLog_roomId_eventType_idx" ON "GameReplayLog"("roomId", "eventType");

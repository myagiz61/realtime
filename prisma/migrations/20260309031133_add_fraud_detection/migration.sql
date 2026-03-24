-- CreateTable
CREATE TABLE "FraudCase" (
    "id" TEXT NOT NULL,
    "roomId" TEXT,
    "gameType" TEXT,
    "primaryUserId" TEXT,
    "secondaryUserId" TEXT,
    "riskScore" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerRiskProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalRiskScore" INTEGER NOT NULL DEFAULT 0,
    "fraudCaseCount" INTEGER NOT NULL DEFAULT 0,
    "suspiciousRoomCount" INTEGER NOT NULL DEFAULT 0,
    "collusionScore" INTEGER NOT NULL DEFAULT 0,
    "botScore" INTEGER NOT NULL DEFAULT 0,
    "dumpingScore" INTEGER NOT NULL DEFAULT 0,
    "timingScore" INTEGER NOT NULL DEFAULT 0,
    "lastFraudAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerRiskProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudSignal" (
    "id" TEXT NOT NULL,
    "roomId" TEXT,
    "gameType" TEXT,
    "userId" TEXT,
    "relatedUserId" TEXT,
    "signalType" TEXT NOT NULL,
    "signalValue" DOUBLE PRECISION NOT NULL,
    "severity" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FraudCase_primaryUserId_createdAt_idx" ON "FraudCase"("primaryUserId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudCase_secondaryUserId_createdAt_idx" ON "FraudCase"("secondaryUserId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudCase_roomId_createdAt_idx" ON "FraudCase"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudCase_severity_createdAt_idx" ON "FraudCase"("severity", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRiskProfile_userId_key" ON "PlayerRiskProfile"("userId");

-- CreateIndex
CREATE INDEX "FraudSignal_userId_createdAt_idx" ON "FraudSignal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudSignal_relatedUserId_createdAt_idx" ON "FraudSignal"("relatedUserId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudSignal_roomId_createdAt_idx" ON "FraudSignal"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudSignal_signalType_createdAt_idx" ON "FraudSignal"("signalType", "createdAt");

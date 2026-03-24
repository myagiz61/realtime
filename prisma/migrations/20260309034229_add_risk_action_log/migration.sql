-- CreateTable
CREATE TABLE "RiskActionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskActionLog_userId_createdAt_idx" ON "RiskActionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskActionLog_actionType_createdAt_idx" ON "RiskActionLog"("actionType", "createdAt");

-- CreateEnum
CREATE TYPE "Okey101Scoring" AS ENUM ('KATLAMALI', 'KATLAMASIZ');

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "maxPlayers" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "okey101Scoring" "Okey101Scoring",
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

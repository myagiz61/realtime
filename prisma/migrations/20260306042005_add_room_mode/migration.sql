/*
  Warnings:

  - Changed the type of `mode` on the `Room` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('SOLO', 'TEAM');

-- AlterTable
ALTER TABLE "Room" DROP COLUMN "mode",
ADD COLUMN     "mode" "GameMode" NOT NULL;

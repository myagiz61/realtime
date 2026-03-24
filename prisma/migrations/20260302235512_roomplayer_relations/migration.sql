-- 1️⃣ Enum oluştur (yoksa)
DO $$ BEGIN
    CREATE TYPE "GameType" AS ENUM ('TAVLA', 'OKEY', 'BATAK');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2️⃣ Text → Enum cast
ALTER TABLE "Room"
ALTER COLUMN "gameType"
TYPE "GameType"
USING "gameType"::"GameType";
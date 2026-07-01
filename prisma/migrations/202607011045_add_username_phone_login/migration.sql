ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "username" TEXT,
ADD COLUMN IF NOT EXISTS "phone" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User"("phone");

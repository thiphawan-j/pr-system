ALTER TABLE "User"
ADD COLUMN "username" TEXT,
ADD COLUMN "phone" TEXT;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

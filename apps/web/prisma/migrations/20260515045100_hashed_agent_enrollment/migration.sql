-- DropIndex
DROP INDEX "Agent_enrollmentToken_key";

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "enrollmentToken",
ADD COLUMN     "enrollmentTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "enrollmentTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Agent_enrollmentTokenHash_key" ON "Agent"("enrollmentTokenHash");


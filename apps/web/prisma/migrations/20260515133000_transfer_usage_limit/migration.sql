CREATE TABLE "TransferUsagePeriod" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "ingressBytes" BIGINT NOT NULL DEFAULT 0,
    "egressBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferUsagePeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransferUsagePeriod_ownerId_periodStart_key" ON "TransferUsagePeriod"("ownerId", "periodStart");

CREATE INDEX "TransferUsagePeriod_ownerId_periodStart_idx" ON "TransferUsagePeriod"("ownerId", "periodStart");

ALTER TABLE "TransferUsagePeriod" ADD CONSTRAINT "TransferUsagePeriod_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

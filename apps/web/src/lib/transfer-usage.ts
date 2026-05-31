import { getPrisma } from "./prisma";

export function currentTransferPeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function transferUsageTotalBytes(usage: {
  ingressBytes: bigint;
  egressBytes: bigint;
}) {
  return usage.ingressBytes + usage.egressBytes;
}

export async function getCurrentTransferUsage(ownerId: string) {
  const periodStart = currentTransferPeriodStart();
  const usage = await getPrisma().transferUsagePeriod.findUnique({
    where: {
      ownerId_periodStart: {
        ownerId,
        periodStart
      }
    }
  });

  return {
    periodStart,
    ingressBytes: usage?.ingressBytes ?? BigInt(0),
    egressBytes: usage?.egressBytes ?? BigInt(0)
  };
}

export async function addTransferUsage(input: {
  ownerId: string;
  ingressBytes: number;
  egressBytes: number;
}) {
  const periodStart = currentTransferPeriodStart();
  return getPrisma().transferUsagePeriod.upsert({
    where: {
      ownerId_periodStart: {
        ownerId: input.ownerId,
        periodStart
      }
    },
    create: {
      ownerId: input.ownerId,
      periodStart,
      ingressBytes: BigInt(input.ingressBytes),
      egressBytes: BigInt(input.egressBytes)
    },
    update: {
      ingressBytes: {
        increment: BigInt(input.ingressBytes)
      },
      egressBytes: {
        increment: BigInt(input.egressBytes)
      }
    }
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { freeMonthlyTransferLimitBytes, isProStatus } from "@/lib/plan";
import { getPrisma } from "@/lib/prisma";
import { verifySharedSecret } from "@/lib/security";
import {
  addTransferUsage,
  getCurrentTransferUsage,
  transferUsageTotalBytes
} from "@/lib/transfer-usage";

const usageSchema = z.object({
  routeId: z.string().min(1),
  ingressBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  egressBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
});

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length);
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token || !verifySharedSecret(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const input = usageSchema.parse(await request.json());
  const route = await getPrisma().route.findUnique({
    where: { id: input.routeId },
    select: {
      id: true,
      domain: {
        select: {
          host: true,
          owner: {
            select: {
              id: true,
              stripeStatus: true
            }
          }
        }
      }
    }
  });

  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  const previousUsage = await getCurrentTransferUsage(route.domain.owner.id);
  const previousTotalBytes = transferUsageTotalBytes(previousUsage);
  const nextUsage = await addTransferUsage({
    ownerId: route.domain.owner.id,
    ingressBytes: input.ingressBytes,
    egressBytes: input.egressBytes
  });
  const nextTotalBytes = transferUsageTotalBytes(nextUsage);

  if (
    !isProStatus(route.domain.owner.stripeStatus) &&
    previousTotalBytes < BigInt(freeMonthlyTransferLimitBytes) &&
    nextTotalBytes >= BigInt(freeMonthlyTransferLimitBytes)
  ) {
    await logAudit(route.domain.owner.id, "billing.transfer_limit.exceeded", {
      routeId: route.id,
      host: route.domain.host,
      usedBytes: nextTotalBytes.toString(),
      limitBytes: freeMonthlyTransferLimitBytes.toString()
    });
  }

  return NextResponse.json({
    ok: true,
    usedBytes: nextTotalBytes.toString(),
    limitBytes: freeMonthlyTransferLimitBytes.toString()
  });
}

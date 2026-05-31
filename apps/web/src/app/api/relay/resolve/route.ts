import { NextResponse } from "next/server";
import { z } from "zod";
import { freeMonthlyTransferLimitBytes, isProStatus } from "@/lib/plan";
import { getPrisma, hasDatabaseUrl } from "@/lib/prisma";
import { verifySharedSecret } from "@/lib/security";
import { getCurrentTransferUsage, transferUsageTotalBytes } from "@/lib/transfer-usage";

const resolveSchema = z.object({
  host: z.string().trim().toLowerCase().min(3).max(253),
  path: z.string().trim().min(1).max(2048)
});

function normalizeHost(host: string) {
  return host.split(":")[0].toLowerCase();
}

function normalizePath(path: string) {
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed.split(/[?#]/)[0];
}

function isPathMatch(path: string, prefix: string) {
  return prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length);
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token || !verifySharedSecret(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is required to resolve relay routes" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const input = resolveSchema.parse({
    host: url.searchParams.get("host"),
    path: url.searchParams.get("path") || "/"
  });
  const host = normalizeHost(input.host);
  const path = normalizePath(input.path);
  const domain = await getPrisma().domain.findFirst({
    where: {
      host,
      verificationStatus: "VERIFIED"
    },
    include: {
      owner: {
        select: {
          id: true,
          stripeStatus: true
        }
      },
      routes: {
        where: {
          isEnabled: true,
          agentId: {
            not: null
          }
        },
        select: {
          id: true,
          agentId: true,
          pathPrefix: true,
          targetPort: true,
          accessTokenHash: true,
          timeoutMs: true
        }
      }
    }
  });

  const route = domain?.routes
    .filter((candidate) => isPathMatch(path, candidate.pathPrefix))
    .sort((left, right) => right.pathPrefix.length - left.pathPrefix.length)[0];

  if (!domain || !route?.agentId) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  const transferUsage = await getCurrentTransferUsage(domain.owner.id);
  const transferUsedBytes = transferUsageTotalBytes(transferUsage);
  if (
    !isProStatus(domain.owner.stripeStatus) &&
    transferUsedBytes >= BigInt(freeMonthlyTransferLimitBytes)
  ) {
    return NextResponse.json(
      {
        error: "Free transfer limit exceeded",
        code: "TRANSFER_LIMIT_EXCEEDED",
        transfer: {
          usedBytes: transferUsedBytes.toString(),
          limitBytes: freeMonthlyTransferLimitBytes.toString()
        }
      },
      { status: 402 },
    );
  }

  return NextResponse.json({
    routeId: route.id,
    agentId: route.agentId,
    targetPort: route.targetPort,
    pathPrefix: route.pathPrefix,
    accessTokenHash: route.accessTokenHash,
    timeoutMs: route.timeoutMs
  });
}

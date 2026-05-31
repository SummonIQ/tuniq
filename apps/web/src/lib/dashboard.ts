import { unstable_noStore as noStore } from "next/cache";
import { logAudit } from "./audit";
import {
  assertProStatus,
  freeMaxRouteTimeoutMs,
  freeMonthlyTransferLimitBytes,
  isProStatus
} from "./plan";
import { createSecret, hashSecret } from "./security";
import { getPrisma } from "./prisma";
import { requireCurrentUser } from "./session";
import { getCurrentTransferUsage, transferUsageTotalBytes } from "./transfer-usage";

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

const minRouteTimeoutMs = 5_000;
const maxRouteTimeoutMs = 600_000;

function getBaseDomain() {
  if (!process.env.PUBLIC_BASE_DOMAIN) {
    throw new Error("PUBLIC_BASE_DOMAIN is required");
  }

  return process.env.PUBLIC_BASE_DOMAIN.toLowerCase();
}

function normalizeTuniqHost(host: string) {
  const baseDomain = getBaseDomain();
  const normalized = host.toLowerCase();
  const label = normalized.endsWith(`.${baseDomain}`)
    ? normalized.slice(0, -`.${baseDomain}`.length)
    : normalized;

  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
    throw new Error("tuniq.dev subdomains must be a single valid DNS label");
  }

  return `${label}.${baseDomain}`;
}

function normalizeCustomHost(host: string) {
  const baseDomain = getBaseDomain();
  const normalized = host.toLowerCase();

  if (normalized === baseDomain || normalized.endsWith(`.${baseDomain}`)) {
    throw new Error("Use the tuniq.dev subdomain option for tuniq.dev hosts");
  }

  if (
    !/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      normalized
    )
  ) {
    throw new Error("Custom domains must be valid fully qualified domains");
  }

  return normalized;
}

function normalizeRoutePath(pathPrefix: string) {
  const trimmed = pathPrefix.trim();
  const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return prefixed.length > 1 ? prefixed.replace(/\/+$/, "") : "/";
}

export async function getDashboardData() {
  noStore();

  const user = await requireCurrentUser();
  const prisma = getPrisma();

  const [domains, agents, auditLogs, transferUsage] = await Promise.all([
    prisma.domain.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        routes: {
          orderBy: { pathPrefix: "asc" },
          include: {
            agent: {
              select: {
                id: true,
                name: true,
                lastSeenAt: true
              }
            }
          }
        }
      }
    }),
    prisma.agent.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        routes: {
          select: { id: true }
        }
      }
    }),
    prisma.auditLog.findMany({
      where: { actorId: user.id },
      orderBy: { createdAt: "desc" },
      take: 12
    }),
    getCurrentTransferUsage(user.id)
  ]);
  const transferUsedBytes = transferUsageTotalBytes(transferUsage);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      stripeStatus: user.stripeStatus,
      stripePriceId: user.stripePriceId,
      isPro: isProStatus(user.stripeStatus),
      hasStripeCustomer: Boolean(user.stripeCustomerId)
    },
    baseDomain: getBaseDomain(),
    domains,
    agents,
    auditLogs,
    transfer: {
      periodStart: transferUsage.periodStart,
      ingressBytes: transferUsage.ingressBytes.toString(),
      egressBytes: transferUsage.egressBytes.toString(),
      usedBytes: transferUsedBytes.toString(),
      freeLimitBytes: freeMonthlyTransferLimitBytes.toString()
    }
  };
}

export async function createDomain(host: string, kind: "TUNIQ_SUBDOMAIN" | "CUSTOM") {
  const user = await requireCurrentUser();
  if (kind === "CUSTOM") {
    assertProStatus(user.stripeStatus, "Custom domains require Pro");
  }

  const normalizedHost =
    kind === "TUNIQ_SUBDOMAIN" ? normalizeTuniqHost(host) : normalizeCustomHost(host);

  const domain = await getPrisma().domain.create({
    data: {
      ownerId: user.id,
      host: normalizedHost,
      kind,
      verificationStatus: kind === "TUNIQ_SUBDOMAIN" ? "VERIFIED" : "PENDING",
      verificationToken: createSecret("verify")
    }
  });

  await logAudit(user.id, "domain.created", {
    domainId: domain.id,
    host: domain.host,
    kind: domain.kind
  });

  return domain;
}

export async function createAgent(name: string) {
  const user = await requireCurrentUser();
  const enrollmentToken = createSecret("enroll");
  const enrollmentTokenExpiry = new Date(Date.now() + 1000 * 60 * 30);

  const agent = await getPrisma().agent.create({
    data: {
      ownerId: user.id,
      name,
      enrollmentTokenHash: hashSecret(enrollmentToken),
      enrollmentTokenExpiry
    },
    select: {
      id: true,
      name: true,
      enrollmentTokenExpiry: true
    }
  });

  await logAudit(user.id, "agent.created", {
    agentId: agent.id,
    name: agent.name
  });

  return {
    agent,
    enrollmentToken
  };
}

export async function createRoute(input: {
  domainId: string;
  agentId?: string;
  pathPrefix: string;
  targetPort: number;
}) {
  const user = await requireCurrentUser();
  const prisma = getPrisma();
  const [domain, agent] = await Promise.all([
    prisma.domain.findFirst({
      where: {
        id: input.domainId,
        ownerId: user.id
      },
      select: { id: true }
    }),
    input.agentId
      ? prisma.agent.findFirst({
          where: {
            id: input.agentId,
            ownerId: user.id
          },
          select: { id: true }
        })
      : Promise.resolve(null)
  ]);

  if (!domain) {
    throw new Error("Domain not found");
  }

  if (input.agentId && !agent) {
    throw new Error("Agent not found");
  }

  const route = await prisma.route.create({
    data: {
      domainId: input.domainId,
      agentId: input.agentId || null,
      pathPrefix: normalizeRoutePath(input.pathPrefix),
      targetPort: input.targetPort
    }
  });

  await logAudit(user.id, "route.created", {
    routeId: route.id,
    domainId: route.domainId,
    agentId: route.agentId,
    pathPrefix: route.pathPrefix,
    targetPort: route.targetPort
  });

  return route;
}

async function requireOwnedRoute(routeId: string) {
  const user = await requireCurrentUser();
  const route = await getPrisma().route.findFirst({
    where: {
      id: routeId,
      domain: {
        ownerId: user.id
      }
    },
    select: {
      id: true,
      accessTokenHash: true,
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
      },
      pathPrefix: true
    }
  });

  if (!route) {
    throw new Error("Route not found");
  }

  return route;
}

export async function setRouteAccessToken(routeId: string) {
  const route = await requireOwnedRoute(routeId);
  const hadToken = Boolean(route.accessTokenHash);
  assertProStatus(route.domain.owner.stripeStatus, "Private route tokens require Pro");

  const accessToken = createSecret("route", 32);
  const accessTokenHint = accessToken.slice(-4);
  await getPrisma().route.update({
    where: { id: route.id },
    data: {
      accessTokenHash: hashSecret(accessToken),
      accessTokenHint
    }
  });

  await logAudit(
    route.domain.owner.id,
    hadToken ? "route.access_token.rotated" : "route.access_token.created",
    {
      routeId: route.id,
      host: route.domain.host,
      pathPrefix: route.pathPrefix,
      accessTokenHint
    },
  );

  return {
    accessToken,
    accessTokenHint,
    curlExample: `curl -H "Authorization: Bearer ${accessToken}" https://${route.domain.host}${route.pathPrefix}`
  };
}

export async function clearRouteAccessToken(routeId: string) {
  const route = await requireOwnedRoute(routeId);
  await getPrisma().route.update({
    where: { id: route.id },
    data: {
      accessTokenHash: null,
      accessTokenHint: null
    }
  });

  await logAudit(route.domain.owner.id, "route.access_token.removed", {
    routeId: route.id,
    host: route.domain.host,
    pathPrefix: route.pathPrefix
  });

  return { ok: true };
}

export async function updateRouteTimeout(routeId: string, timeoutMs: number) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < minRouteTimeoutMs || timeoutMs > maxRouteTimeoutMs) {
    throw new Error("Timeout must be between 5 and 600 seconds");
  }

  const route = await requireOwnedRoute(routeId);
  if (timeoutMs > freeMaxRouteTimeoutMs) {
    assertProStatus(route.domain.owner.stripeStatus, "Timeouts over 60 seconds require Pro");
  }

  await getPrisma().route.update({
    where: { id: route.id },
    data: { timeoutMs }
  });

  await logAudit(route.domain.owner.id, "route.timeout.updated", {
    routeId: route.id,
    host: route.domain.host,
    pathPrefix: route.pathPrefix,
    timeoutMs
  });

  return { timeoutMs };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { isProStatus } from "@/lib/plan";
import { getPrisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { getCurrentTransferUsage, transferUsageTotalBytes } from "@/lib/transfer-usage";

export const dynamic = "force-dynamic";

type JsonRpcId = string | number | null;

const protocolVersion = "2024-11-05";

const rpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional()
});

const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional()
});

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    result
  });
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message
      }
    },
    { status: code === -32001 ? 401 : 200 }
  );
}

function textToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function listTools() {
  return {
    tools: [
      {
        name: "tuniq.account_summary",
        description: "Return the authenticated Tuniq account plan, transfer usage, and object counts.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: "tuniq.list_domains",
        description: "List domains and routes owned by the authenticated Tuniq account.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: "tuniq.list_agents",
        description: "List enrolled desktop agents and their route counts.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }
    ]
  };
}

async function getAuthenticatedDbUser() {
  const sessionUser = await getCurrentUser();

  if (!sessionUser) {
    return null;
  }

  return getPrisma().user.upsert({
    where: { id: sessionUser.id },
    update: {
      email: sessionUser.email,
      name: sessionUser.name,
      emailVerified: Boolean(sessionUser.emailVerified),
      image: sessionUser.image
    },
    create: {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      emailVerified: Boolean(sessionUser.emailVerified),
      image: sessionUser.image
    }
  });
}

async function callTool(userId: string, name: string) {
  const prisma = getPrisma();

  if (name === "tuniq.account_summary") {
    const [user, domainCount, routeCount, agentCount, transferUsage] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          stripeStatus: true,
          stripePriceId: true
        }
      }),
      prisma.domain.count({ where: { ownerId: userId } }),
      prisma.route.count({
        where: {
          domain: {
            ownerId: userId
          }
        }
      }),
      prisma.agent.count({ where: { ownerId: userId } }),
      getCurrentTransferUsage(userId)
    ]);

    return textToolResult({
      email: user.email,
      plan: isProStatus(user.stripeStatus) ? "pro" : "free",
      stripeStatus: user.stripeStatus,
      stripePriceId: user.stripePriceId,
      counts: {
        domains: domainCount,
        routes: routeCount,
        agents: agentCount
      },
      transfer: {
        periodStart: transferUsage.periodStart.toISOString(),
        ingressBytes: transferUsage.ingressBytes.toString(),
        egressBytes: transferUsage.egressBytes.toString(),
        usedBytes: transferUsageTotalBytes(transferUsage).toString()
      }
    });
  }

  if (name === "tuniq.list_domains") {
    const domains = await prisma.domain.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        host: true,
        kind: true,
        verificationStatus: true,
        createdAt: true,
        routes: {
          orderBy: { pathPrefix: "asc" },
          select: {
            id: true,
            pathPrefix: true,
            targetPort: true,
            timeoutMs: true,
            isEnabled: true,
            accessTokenHint: true,
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
    });

    return textToolResult({
      domains: domains.map((domain) => ({
        ...domain,
        createdAt: domain.createdAt.toISOString(),
        routes: domain.routes.map((route) => ({
          ...route,
          access: route.accessTokenHint ? `private:${route.accessTokenHint}` : "public",
          agent: route.agent
            ? {
                ...route.agent,
                lastSeenAt: route.agent.lastSeenAt?.toISOString() ?? null
              }
            : null,
          accessTokenHint: undefined
        }))
      }))
    });
  }

  if (name === "tuniq.list_agents") {
    const agents = await prisma.agent.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        platform: true,
        version: true,
        lastSeenAt: true,
        createdAt: true,
        routes: {
          select: {
            id: true,
            pathPrefix: true,
            targetPort: true,
            domain: {
              select: {
                host: true
              }
            }
          }
        }
      }
    });

    return textToolResult({
      agents: agents.map((agent) => ({
        ...agent,
        createdAt: agent.createdAt.toISOString(),
        lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
        routeCount: agent.routes.length
      }))
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Invalid JSON");
  }

  if (Array.isArray(body)) {
    return jsonRpcError(null, -32600, "Batch MCP requests are not supported");
  }

  const parsed = rpcRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonRpcError(null, -32600, "Invalid MCP request");
  }

  const id = parsed.data.id ?? null;

  if (parsed.data.id === undefined && parsed.data.method.startsWith("notifications/")) {
    return new Response(null, { status: 204 });
  }

  const user = await getAuthenticatedDbUser();

  if (!user) {
    return jsonRpcError(id, -32001, "Authentication required");
  }

  if (parsed.data.method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion,
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "tuniq-web",
        version: "0.1.0"
      }
    });
  }

  if (parsed.data.method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (parsed.data.method === "tools/list") {
    return jsonRpcResult(id, listTools());
  }

  if (parsed.data.method === "tools/call") {
    const toolCall = toolCallSchema.safeParse(parsed.data.params);

    if (!toolCall.success) {
      return jsonRpcError(id, -32602, "Invalid tool call parameters");
    }

    if (toolCall.data.arguments && Object.keys(toolCall.data.arguments).length > 0) {
      return jsonRpcError(id, -32602, "This tool does not accept arguments");
    }

    try {
      return jsonRpcResult(id, await callTool(user.id, toolCall.data.name));
    } catch (error) {
      return jsonRpcError(
        id,
        -32602,
        error instanceof Error ? error.message : "Tool call failed"
      );
    }
  }

  return jsonRpcError(id, -32601, `Method not found: ${parsed.data.method}`);
}

export async function GET() {
  return NextResponse.json({
    name: "tuniq-web",
    protocolVersion,
    transport: "streamable-http",
    endpoint: "/api/mcp",
    authentication: "better-auth-session"
  });
}

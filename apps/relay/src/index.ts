import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createPendingTunnelResponse,
  decodeResponseFrame,
  verifyAccessTokenHash
} from "./protocol";

type AgentSocketData = {
  agentId: string;
};

type TunnelRequest = {
  type: "request";
  requestId: string;
  method: string;
  path: string;
  targetPort: number;
  headers: Record<string, string>;
  bodyBase64: string;
};

const port = Number(process.env.PORT ?? 8787);
const appUrl = process.env.TUNIQ_APP_URL;
const baseDomain = process.env.PUBLIC_BASE_DOMAIN;
const sharedSecret = process.env.TUNIQ_RELAY_SHARED_SECRET;

if (!sharedSecret) {
  throw new Error("TUNIQ_RELAY_SHARED_SECRET is required");
}

if (!appUrl) {
  throw new Error("TUNIQ_APP_URL is required");
}

if (!baseDomain) {
  throw new Error("PUBLIC_BASE_DOMAIN is required");
}

const agents = new Map<string, ServerWebSocket<AgentSocketData>>();
const pending = new Map<string, ReturnType<typeof createPendingTunnelResponse>>();

type ResolvedRoute = {
  routeId: string;
  agentId: string;
  targetPort: number;
  pathPrefix: string;
  accessTokenHash: string | null;
  timeoutMs: number;
};

type ResolveRouteResult =
  | {
      ok: true;
      route: ResolvedRoute;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

// Vercel's external rewrites discard the original Host header, so the web
// app encodes the original subdomain as a /__tuniqhost/<host>/ prefix on
// the destination URL. parsePathHost extracts and strips that prefix.
function parsePathHost(pathname: string): { host: string | null; pathname: string } {
  const prefix = "/__tuniqhost/";
  if (!pathname.startsWith(prefix)) {
    return { host: null, pathname };
  }
  const remainder = pathname.slice(prefix.length);
  const slashIndex = remainder.indexOf("/");
  if (slashIndex === -1) {
    return { host: remainder || null, pathname: "/" };
  }
  const host = remainder.slice(0, slashIndex);
  const rest = remainder.slice(slashIndex);
  return { host: host || null, pathname: rest };
}

function requestHost(request: Request) {
  const url = new URL(request.url);
  const fromPath = parsePathHost(url.pathname).host;
  if (fromPath) return fromPath.split(":")[0];
  return (
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().split(":")[0] ??
    request.headers.get("host")?.split(":")[0] ??
    ""
  );
}

function requestPath(request: Request) {
  const url = new URL(request.url);
  const stripped = parsePathHost(url.pathname).pathname;
  return `${stripped}${url.search}`;
}

async function resolveRoute(request: Request): Promise<ResolveRouteResult> {
  const lookupUrl = new URL("/api/relay/resolve", appUrl);
  const host = requestHost(request);
  const path = requestPath(request);
  lookupUrl.searchParams.set("host", host);
  lookupUrl.searchParams.set("path", path);

  // Concise per-request log; remove once stable.
  console.log(`[relay] resolve host=${host} path=${path}`);

  const response = await fetch(lookupUrl, {
    headers: {
      authorization: `Bearer ${sharedSecret}`
    }
  });


  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      ok: false,
      status: response.status === 402 ? 402 : response.status === 404 ? 404 : 502,
      message: body?.error ?? "Route not found"
    };
  }

  const body = (await response.json()) as ResolvedRoute;
  if (
    typeof body.agentId !== "string" ||
    typeof body.routeId !== "string" ||
    typeof body.targetPort !== "number" ||
    typeof body.pathPrefix !== "string" ||
    typeof body.timeoutMs !== "number" ||
    (body.accessTokenHash !== null && typeof body.accessTokenHash !== "string")
  ) {
    return {
      ok: false,
      status: 502,
      message: "Invalid route resolution response"
    };
  }

  return {
    ok: true,
    route: body
  };
}

function reportTransferUsage(routeId: string, ingressBytes: number, egressBytes: number) {
  const usageUrl = new URL("/api/relay/usage", appUrl);

  void fetch(usageUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sharedSecret}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      routeId,
      ingressBytes,
      egressBytes
    })
  }).catch((error) => {
    console.error(`failed to report transfer usage for route ${routeId}:`, error);
  });
}

function stripRoutePrefix(request: Request, pathPrefix: string) {
  const url = new URL(request.url);
  const cleaned = parsePathHost(url.pathname).pathname;
  if (pathPrefix === "/") {
    return `${cleaned}${url.search}`;
  }

  if (cleaned === pathPrefix) {
    return `/${url.search}`;
  }

  if (cleaned.startsWith(`${pathPrefix}/`)) {
    return `${cleaned.slice(pathPrefix.length)}${url.search}`;
  }

  return `${cleaned}${url.search}`;
}

function verifyRelayToken(token: string, expectedAgentId: string) {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = createHmac("sha256", sharedSecret)
    .update(payload)
    .digest("base64url");

  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      agentId?: string;
      exp?: number;
    };

    return (
      parsed.agentId === expectedAgentId &&
      typeof parsed.exp === "number" &&
      parsed.exp > Date.now() / 1000
    );
  } catch {
    return false;
  }
}

const server = Bun.serve<AgentSocketData>({
  port,
  async fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        agents: agents.size,
        baseDomain
      });
    }

    if (url.pathname === "/agent") {
      const token = url.searchParams.get("token");
      const agentId = url.searchParams.get("agentId");

      if (!token || !agentId || !verifyRelayToken(token, agentId)) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (
        server.upgrade(request, {
          data: { agentId }
        })
      ) {
        return undefined;
      }

      return new Response("Upgrade failed", { status: 400 });
    }

    const resolvedRoute = await resolveRoute(request);
    if (!resolvedRoute.ok) {
      return new Response(resolvedRoute.message, { status: resolvedRoute.status });
    }
    const route = resolvedRoute.route;

    if (!verifyAccessTokenHash(route.accessTokenHash, request.headers.get("authorization"))) {
      return new Response("Unauthorized", { status: 401 });
    }

    const agent = agents.get(route.agentId);
    if (!agent || agent.readyState !== WebSocket.OPEN) {
      return new Response("Agent offline", { status: 503 });
    }

    const requestId = crypto.randomUUID();
    const body = new Uint8Array(await request.arrayBuffer());
    const usage = {
      egressBytes: 0
    };
    const headers = Object.fromEntries(request.headers.entries());
    delete headers.authorization;

    const frame: TunnelRequest = {
      type: "request",
      requestId,
      method: request.method,
      path: stripRoutePrefix(request, route.pathPrefix),
      targetPort: route.targetPort,
      headers,
      bodyBase64: Buffer.from(body).toString("base64")
    };

    const pendingResponse = createPendingTunnelResponse(route.timeoutMs, () => {
      pending.delete(requestId);
      reportTransferUsage(route.routeId, body.byteLength, usage.egressBytes);
    });
    const pendingEntry = Object.assign(pendingResponse, { usage });
    pending.set(requestId, pendingEntry);

    agent.send(JSON.stringify(frame));
    return pendingResponse.response;
  },
  websocket: {
    open(socket) {
      agents.set(socket.data.agentId, socket);
      console.log(`agent connected: ${socket.data.agentId}`);
    },
    message(socket, message) {
      if (typeof message !== "string") {
        return;
      }

      const frame = decodeResponseFrame(message);
      if (!frame) {
        return;
      }

      const match = pending.get(frame.requestId);
      if (!match) {
        return;
      }

      if (frame.type === "response-chunk") {
        const bodyBytes = Buffer.from(frame.bodyBase64, "base64").byteLength;
        const tracked = match as ReturnType<typeof createPendingTunnelResponse> & {
          usage?: { egressBytes: number };
        };
        if (tracked.usage) {
          tracked.usage.egressBytes += bodyBytes;
        }
      }

      match.applyFrame(frame);
    },
    close(socket) {
      if (agents.get(socket.data.agentId) === socket) {
        agents.delete(socket.data.agentId);
      }
      console.log(`agent disconnected: ${socket.data.agentId}`);
    }
  }
});

console.log(`Tuniq relay listening on http://localhost:${server.port}`);

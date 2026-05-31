# Tuniq

Tuniq is a Bun-managed monorepo for a secure developer tunneling product:

- `apps/web`: Next.js 16 App Router, TypeScript, Tailwind CSS, Prisma ORM.
- `apps/desktop`: Tauri 2 desktop app with React and Rust tunnel commands.
- `apps/relay`: Bun WebSocket/HTTP relay for forwarding public requests to a connected desktop agent.

## Local Setup

```bash
bun install
cp .env.example apps/web/.env
```

Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and Stripe env vars, then run:

```bash
bun run prisma:generate
bun run prisma:migrate
bun run dev:web
```

Local Stripe webhook forwarding:

```bash
stripe listen --forward-to localhost:10180/api/stripe/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.

Run the local relay:

```bash
TUNIQ_APP_URL="http://localhost:10180" \
PUBLIC_BASE_DOMAIN="tuniq.dev" \
TUNIQ_RELAY_SHARED_SECRET="$(openssl rand -base64 32)" \
bun run dev:relay
```

Run the desktop app:

```bash
bun run dev:desktop
```

Dashboard routes accept target ports from `10000` through `65535` to avoid the
low-numbered ports that are commonly used by local framework defaults. The
desktop app forwards each request to the route target port supplied by the relay
and includes a keep-awake setting that prevents computer sleep while long-running
tunnels are active.

Responses stream through the tunnel by default. SSE, chunked transfer, long-lived
responses, and file downloads are forwarded chunk-by-chunk after the upstream
service sends response headers. Request bodies are still buffered before
forwarding.

Routes can be public or private. Private routes require
`Authorization: Bearer <route token>` at the relay boundary; the bearer token is
hashed in the database and stripped before traffic reaches the local service.
Each route also has a configurable time-to-first-byte timeout from 5 seconds to
10 minutes. Streaming responses can continue after the first byte without being
cut off by that timeout.

Free workspaces include 1 GB of monthly transfer, counted as request bytes plus
response bytes. The relay records usage through the authenticated web API after
each tunneled request and stops resolving Free routes once the monthly cap is
reached. Pro workspaces are not capped.

## MCP Servers

The web app exposes a session-authenticated MCP endpoint at `/api/mcp`.
Authenticated clients can call read-only tools for account summary, domains,
routes, and agents. Route access token hashes and plaintext tokens are never
returned by MCP tools.

The desktop app starts a loopback MCP endpoint when the app launches:

```text
http://127.0.0.1:38789/mcp
```

Desktop MCP tools can read tunnel status, start or stop the local tunnel, and
toggle keep-awake. The endpoint binds to `127.0.0.1` only. Set
`TUNIQ_DESKTOP_MCP_TOKEN` before launching the desktop app to require
`Authorization: Bearer <token>` for local MCP requests.

## Tunnel Flow

1. Create an agent enrollment token in the web dashboard.
2. Start the relay with the same `TUNIQ_RELAY_SHARED_SECRET` used by the web app.
3. In the desktop app, enter the Tuniq app URL and one-time enrollment token.
4. The desktop app stores the returned agent API token and signed relay token.
5. Start the tunnel with the relay WebSocket URL and a local port.
6. Public relay requests are forwarded to `127.0.0.1:<route target port>` through the connected desktop agent.

For production, put the relay behind `*.tuniq.dev`, keep `TUNIQ_RELAY_SHARED_SECRET`
identical in the web and relay environments, and configure DNS/customer-domain
validation before enabling public traffic.

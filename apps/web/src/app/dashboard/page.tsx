import Link from "next/link";
import {
  createCheckoutSessionAction,
  createCustomerPortalSessionAction
} from "@/lib/billing";
import { createDomainAction, createRouteAction } from "@/lib/actions";
import { getDashboardData } from "@/lib/dashboard";
import { AgentEnrollmentForm } from "@/components/agent-enrollment-form";
import { RoutesTable } from "@/components/routes-table";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";

function formatSeen(date: Date | string | null) {
  if (!date) return "never";
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round((new Date(date).getTime() - Date.now()) / 60_000),
    "minute"
  );
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <main className="min-h-screen bg-surface text-foreground">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold">
            Tuniq
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-sm text-muted">{data.user.email}</div>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-lg border border-line bg-card p-4">
            <h2 className="text-sm font-semibold">Billing</h2>
            <p className="mt-2 text-sm text-muted">
              Status: {data.user.stripeStatus ?? "not subscribed"}
            </p>
            <form
              action={
                data.user.hasStripeCustomer
                  ? createCustomerPortalSessionAction
                  : createCheckoutSessionAction
              }
              className="mt-4"
            >
              <button className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-background">
                {data.user.hasStripeCustomer ? "Manage billing" : "Start Pro"}
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-line bg-card p-4">
            <h2 className="text-sm font-semibold">Add domain</h2>
            <form action={createDomainAction} className="mt-4 space-y-3">
              <input
                name="host"
                placeholder={`preview or preview.${data.baseDomain}`}
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
                required
              />
              <select
                name="kind"
                className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
                defaultValue="TUNIQ_SUBDOMAIN"
              >
                <option value="TUNIQ_SUBDOMAIN">tuniq.dev subdomain</option>
                <option value="CUSTOM">custom domain</option>
              </select>
              <button className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-background">
                Create domain
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-line bg-card p-4">
            <h2 className="text-sm font-semibold">Enroll desktop agent</h2>
            <AgentEnrollmentForm />
          </section>

          <section className="rounded-lg border border-line bg-card p-4">
            <h2 className="text-sm font-semibold">Help</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Tunnels support SSE, chunked transfer, long-lived streams, and file
              downloads. Request bodies are currently buffered before forwarding.
            </p>
          </section>
        </aside>

        <div className="space-y-6">
          <section className="rounded-lg border border-line bg-card">
            <div className="border-b border-line px-5 py-4">
              <h1 className="text-base font-semibold">Domains and routes</h1>
              <p className="mt-1 text-sm text-muted">
                Map hosts and paths to local ports exposed by connected agents.
              </p>
            </div>
            <div className="divide-y divide-line">
              {data.domains.map((domain) => (
                <div key={domain.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{domain.host}</p>
                      <p className="mt-1 text-xs uppercase text-muted">
                        {domain.kind} · {domain.verificationStatus}
                      </p>
                      {domain.kind === "CUSTOM" && domain.verificationStatus !== "VERIFIED" ? (
                        <div className="mt-3 rounded-md border border-line bg-surface p-3">
                          <p className="text-xs font-semibold uppercase text-muted">
                            DNS verification
                          </p>
                          <p className="mt-2 text-sm text-muted">
                            Add a TXT record named{" "}
                            <code className="rounded bg-card px-1 py-0.5 font-mono text-xs">
                              _tuniq.{domain.host}
                            </code>{" "}
                            with this value:
                          </p>
                          <code className="mt-2 block break-all rounded bg-card p-2 font-mono text-xs">
                            {domain.verificationToken}
                          </code>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <RoutesTable domain={domain} isPro={data.user.isPro} />

                  <form action={createRouteAction} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                    <input type="hidden" name="domainId" value={domain.id} />
                    <input
                      name="pathPrefix"
                      defaultValue="/"
                      className="rounded-md border border-line px-3 py-2 text-sm"
                    />
                    <input
                      name="targetPort"
                      type="number"
                      min="10000"
                      max="65535"
                      placeholder="30380"
                      className="rounded-md border border-line px-3 py-2 text-sm"
                      required
                    />
                    <select name="agentId" className="rounded-md border border-line bg-card px-3 py-2 text-sm">
                      <option value="">Unassigned</option>
                      {data.agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold">
                      Add route
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-card">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold">Desktop agents</h2>
            </div>
            <div className="divide-y divide-line">
              {data.agents.map((agent) => (
                <div key={agent.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto_auto]">
                  <div>
                    <p className="font-medium">{agent.name}</p>
                    <p className="mt-1 font-mono text-xs text-muted">{agent.id}</p>
                  </div>
                  <div className="text-sm text-muted">{agent.platform ?? "unknown platform"}</div>
                  <div className="text-sm text-muted">seen {formatSeen(agent.lastSeenAt)}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

import Link from "next/link";
import { MarketingHeroScene } from "@/components/marketing-hero-scene";
import { ThemeToggle } from "@/components/theme-toggle";

const platformRows = [
  ["Route ownership", "Domains, tuniq.dev subdomains, and path prefixes live in one control plane."],
  ["Boundary access", "Private routes require bearer tokens at the relay before traffic touches localhost."],
  ["Streaming transport", "SSE, downloads, chunked responses, and long polling stream after first byte."],
  ["Desktop control", "The agent keeps an outbound relay socket and exposes a local MCP control surface."]
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="fixed left-0 right-0 top-0 z-40 border-b border-line/70 bg-background/82 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3 text-sm font-black tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-foreground text-background">
              T
            </span>
            Tuniq
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted md:flex">
            <Link className="hover:text-foreground" href="#routing">
              Routing
            </Link>
            <Link className="hover:text-foreground" href="#security">
              Security
            </Link>
            <Link className="hover:text-foreground" href="#pricing">
              Pricing
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/dashboard"
              className="rounded-full bg-foreground px-4 py-2 text-sm font-bold text-background transition hover:translate-y-[-1px]"
            >
              Open app
            </Link>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-5 pb-24 pt-32 lg:grid-cols-[0.92fr_1.08fr] lg:pt-36">
        <div className="absolute inset-x-[-20%] top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_30%_20%,rgba(0,168,145,0.10),transparent_30%)]" />
        <div>
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Tunnels for real domains
          </p>
          <h1 className="max-w-xl text-[clamp(3rem,6.4vw,5.6rem)] font-black leading-[0.92] tracking-tight">
            Ship local services through real domains.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-muted">
            Private access, streaming responses, and per-route timeouts in front
            of anything running on your laptop.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-full bg-accent px-5 py-3 text-sm font-black text-on-accent shadow-[0_18px_55px_rgba(15,118,110,0.22)]"
            >
              Start tunneling
            </Link>
            <a
              href="#routing"
              className="rounded-full border border-line bg-card px-5 py-3 text-sm font-bold text-foreground"
            >
              How it routes
            </a>
          </div>
        </div>

        <MarketingHeroScene />
      </section>

      <section id="routing" className="border-y border-line bg-card">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <h2 className="max-w-xl text-5xl font-black leading-none tracking-tight">
              Route policy lives in the cloud. Traffic stays on the tunnel.
            </h2>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted">
              A route resolves host and path to an enrolled desktop agent and a
              high local port. The relay enforces access and timeout policy before
              forwarding across the agent socket.
            </p>
          </div>
          <div className="grid gap-3">
            {platformRows.map(([title, copy]) => (
              <div className="grid gap-2 rounded-2xl border border-line bg-surface p-6 sm:grid-cols-[180px_1fr]" key={title}>
                <p className="font-mono text-xs uppercase text-accent">{title}</p>
                <p className="text-sm leading-6 text-muted">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="mx-auto max-w-7xl px-5 py-24">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-line bg-card p-8">
            <h2 className="text-4xl font-black tracking-tight">Private tunnels without app changes.</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {[
                "SHA-256 token hashes in the database",
                "One-time reveal when tokens are created",
                "Relay strips Authorization before forwarding",
                "Audit log records token and billing changes"
              ].map((item) => (
                <div className="rounded-2xl bg-surface p-5 text-sm font-bold leading-6" key={item}>
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[28px] bg-foreground p-8 text-background">
            <p className="font-mono text-xs uppercase text-background/48">example request</p>
            <pre className="mt-8 overflow-x-auto rounded-2xl bg-background/8 p-5 text-sm leading-7 text-background/82">
{`curl -H "Authorization: Bearer <token>" \\
  https://admin.acme.com/

relay:
  resolve route
  verify bearer
  forward to 127.0.0.1:30380`}
            </pre>
          </div>
        </div>
      </section>

      <section id="pricing" className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-5 px-5 py-24 lg:grid-cols-2">
          <article className="rounded-[28px] border border-line bg-card p-8">
            <h2 className="text-3xl font-black tracking-tight">Free</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Public tuniq.dev tunnels for demos, prototypes, and short-lived previews.
            </p>
            <p className="mt-8 font-mono text-5xl font-black">1 GB</p>
            <p className="mt-2 text-sm text-muted">monthly transfer included</p>
          </article>
          <article className="rounded-[28px] border border-accent bg-[#071018] p-8 text-white shadow-[0_28px_90px_rgba(0,0,0,0.18)]">
            <h2 className="text-3xl font-black tracking-tight">Pro</h2>
            <p className="mt-4 text-sm leading-6 text-white/62">
              Custom domains, private route tokens, uncapped transfer, and 10 minute first-byte timeouts.
            </p>
            <p className="mt-8 font-mono text-5xl font-black text-[#35e0c7]">10m</p>
            <p className="mt-2 text-sm text-white/54">route timeout ceiling</p>
          </article>
        </div>
      </section>
    </main>
  );
}

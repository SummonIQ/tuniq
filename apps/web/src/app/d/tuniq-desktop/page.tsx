import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Tuniq Desktop",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } }
};

const steps = [
  ["Download the DMG", "Click the button below. The file is roughly 4.5 MB."],
  ["Drag Tuniq into Applications", "The DMG opens to a drag-and-drop installer."],
  ["First-launch warning", "macOS may say the developer is unverified — right-click the app and choose Open to bypass."],
  ["Sign in at tuniq.dev", "Create an account, generate an enrollment token from the dashboard, then paste it into the desktop app."]
];

export default function DesktopDownloadPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-16">
        <Link href="/" className="flex items-center gap-3 text-sm font-black tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-foreground text-background">
            T
          </span>
          Tuniq
        </Link>

        <section className="mt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Preview build · macOS · Apple Silicon
          </p>
          <h1 className="mt-4 text-5xl font-black tracking-tight">
            Tuniq Desktop
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-7 text-muted">
            The agent that connects your computer to a Tuniq route. Outbound
            WSS only — no inbound ports, no firewall changes.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="/downloads/Tuniq.dmg"
              className="rounded-full bg-foreground px-6 py-3 text-sm font-bold text-background transition hover:translate-y-[-1px]"
              download
            >
              Download Tuniq.dmg
            </a>
            <span className="text-xs text-muted">v0.1.0 · aarch64 · ~4.5 MB</span>
          </div>
        </section>

        <section className="mt-16 border-t border-line/70 pt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
            Setup
          </h2>
          <ol className="mt-6 space-y-5">
            {steps.map(([title, body], index) => (
              <li key={title} className="flex gap-4">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line/70 text-sm font-bold">
                  {index + 1}
                </span>
                <div>
                  <p className="text-base font-semibold">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <p className="mt-auto pt-16 text-xs text-muted">
          This page is unlisted. Share the URL only with people you trust.
        </p>
      </div>
    </main>
  );
}

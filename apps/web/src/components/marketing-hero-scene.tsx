"use client";

import { useEffect, useState } from "react";

const routes = [
  {
    id: "admin",
    host: "admin.acme.com",
    path: "/",
    port: "30380",
    state: "private",
    latency: "42ms",
    transfer: "128 MB",
    accent: "bg-[#18d7bf]"
  },
  {
    id: "api",
    host: "api-staging.tuniq.dev",
    path: "/v1",
    port: "30410",
    state: "public",
    latency: "58ms",
    transfer: "42 MB",
    accent: "bg-[#f4b24d]"
  },
  {
    id: "docs",
    host: "docs.acme.com",
    path: "/preview",
    port: "30520",
    state: "streaming",
    latency: "open",
    transfer: "1.2 GB",
    accent: "bg-[#8bb7ff]"
  }
];

export function MarketingHeroScene() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % routes.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, []);

  const active = routes[index];

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#071018] text-white shadow-[0_40px_120px_rgba(0,0,0,0.28)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_22%,rgba(24,215,191,0.22),transparent_36%)]" />

      <div className="relative flex flex-col gap-6 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] text-white/60">
            relay.tuniq.dev
          </div>
        </div>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
            active route
          </p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">{active.host}</h3>
          <p className="mt-1.5 font-mono text-sm text-white/55">
            {active.path} {"->"} 127.0.0.1:{active.port}
          </p>
        </div>

        <div className="relative">
          <div className="h-px bg-white/10" />
          <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
            <div className={`h-full w-1/3 animate-[tuniq-flow_2s_ease-in-out_infinite] ${active.accent} motion-reduce:animate-none`} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "internet", caption: "request" },
            { label: "relay", caption: "policy" },
            { label: "desktop", caption: "loopback" }
          ].map((node, i) => (
            <div
              className="rounded-2xl border border-white/8 bg-white/[0.03] p-3.5"
              key={node.label}
            >
              <span
                className={`mb-5 block h-2 w-2 rounded-full ${
                  i === 1 ? active.accent : "bg-white/30"
                }`}
              />
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/45">
                {node.label}
              </p>
              <p className="mt-1 text-sm font-semibold">{node.caption}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "state", value: active.state },
            { label: "latency", value: active.latency },
            { label: "transfer", value: active.transfer }
          ].map((metric) => (
            <div className="rounded-2xl bg-white/[0.04] p-3.5" key={metric.label}>
              <p className="font-mono text-[10px] uppercase tracking-wider text-white/45">
                {metric.label}
              </p>
              <p className="mt-1.5 font-mono text-base">{metric.value}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {routes.map((route, i) => (
            <button
              aria-label={`Show ${route.host}`}
              className={`h-1 flex-1 rounded-full transition ${
                i === index ? "bg-[#18d7bf]" : "bg-white/15 hover:bg-white/25"
              }`}
              key={route.id}
              onClick={() => setIndex(i)}
              type="button"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

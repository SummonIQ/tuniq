"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type RouteRow = {
  id: string;
  pathPrefix: string;
  targetPort: number;
  accessTokenHash: string | null;
  accessTokenHint: string | null;
  timeoutMs: number;
  isEnabled: boolean;
  agent: {
    name: string;
  } | null;
};

type Reveal = {
  routeId: string;
  accessToken: string;
  accessTokenHint: string;
  curlExample: string;
};

type Toast = {
  message: string;
  tone: "success" | "error";
};

type Props = {
  domain: {
    host: string;
    routes: RouteRow[];
  };
  isPro: boolean;
};

const minTimeoutSeconds = 5;
const proMaxTimeoutSeconds = 600;
const freeMaxTimeoutSeconds = 60;

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      {locked ? (
        <>
          <rect height="11" rx="2" width="16" x="4" y="11" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </>
      ) : (
        <>
          <rect height="11" rx="2" width="16" x="4" y="11" />
          <path d="M8 11V7a4 4 0 0 1 7.8-1.2" />
        </>
      )}
    </svg>
  );
}

function formatTimeout(timeoutMs: number) {
  const seconds = Math.round(timeoutMs / 1000);
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

function routeUrl(host: string, pathPrefix: string) {
  return `https://${host}${pathPrefix}`;
}

export function RoutesTable({ domain, isPro }: Props) {
  const router = useRouter();
  const [routeUpdates, setRouteUpdates] = useState<Record<string, Partial<RouteRow>>>({});
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const routes = domain.routes.map((route) => ({
    ...route,
    ...routeUpdates[route.id]
  }));
  const maxTimeoutSeconds = isPro ? proMaxTimeoutSeconds : freeMaxTimeoutSeconds;

  function updateRoute(routeId: string, update: Partial<RouteRow>) {
    setRouteUpdates((current) => ({
      ...current,
      [routeId]: {
        ...current[routeId],
        ...update
      }
    }));
  }

  async function makePrivate(route: RouteRow, shouldConfirm: boolean) {
    if (!isPro) {
      setToast({ tone: "error", message: "Private route tokens require Pro" });
      return;
    }

    if (
      shouldConfirm &&
      !window.confirm("This breaks any client using the old token. Continue?")
    ) {
      return;
    }

    const response = await fetch(`/api/routes/${route.id}/access-token`, {
      method: "POST"
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setToast({ tone: "error", message: body?.error ?? "Could not update access token" });
      return;
    }

    const body = (await response.json()) as Reveal;
    setReveal({ ...body, routeId: route.id });
    updateRoute(route.id, {
      accessTokenHash: "set",
      accessTokenHint: body.accessTokenHint
    });
    setToast({ tone: "success", message: "Private route token updated" });
    router.refresh();
  }

  async function removeToken(route: RouteRow) {
    if (
      !window.confirm("Anyone with the URL will be able to access this tunnel. Continue?")
    ) {
      return;
    }

    const previous = route;
    updateRoute(route.id, {
      accessTokenHash: null,
      accessTokenHint: null
    });

    const response = await fetch(`/api/routes/${route.id}/access-token`, {
      method: "DELETE"
    });

    if (!response.ok) {
      updateRoute(route.id, previous);
      setToast({ tone: "error", message: "Could not remove access token" });
      return;
    }

    setToast({ tone: "success", message: "Route is public" });
    router.refresh();
  }

  async function copyToken() {
    if (!reveal) {
      return;
    }

    await navigator.clipboard.writeText(reveal.accessToken);
    setToast({ tone: "success", message: "Token copied" });
  }

  return (
    <div className="mt-4 overflow-x-auto">
      {toast ? (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-sm ${
            toast.tone === "error"
              ? "border-danger/30 bg-danger-bg text-danger"
              : "border-positive/30 bg-positive-bg text-positive"
          }`}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Path</th>
            <th className="py-2 pr-3 font-medium">Port</th>
            <th className="py-2 pr-3 font-medium">Agent</th>
            <th className="py-2 pr-3 font-medium">Access</th>
            <th className="py-2 pr-3 font-medium">Timeout</th>
            <th className="py-2 pr-3 font-medium">Enabled</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Route actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => (
            <RouteTableRow
              key={route.id}
              domainHost={domain.host}
              editingRouteId={editingRouteId}
              onEdit={setEditingRouteId}
              onMakePrivate={() => makePrivate(route, false)}
              onRemoveToken={() => removeToken(route)}
              onRotateToken={() => makePrivate(route, true)}
              onToast={setToast}
              onUpdateRoute={updateRoute}
              isPro={isPro}
              maxTimeoutSeconds={maxTimeoutSeconds}
              route={route}
            />
          ))}
        </tbody>
      </table>

      {reveal ? (
        <div
          aria-labelledby="route-token-title"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
          role="dialog"
        >
          <div className="w-full max-w-xl rounded-lg border border-line bg-card p-5 shadow-xl">
            <h2 id="route-token-title" className="text-base font-semibold">
              Route access token
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              This token is shown once. Store it now; refreshing or closing this modal
              will not reveal it again.
            </p>
            <label className="mt-4 block text-sm font-medium">
              Bearer token
              <input
                className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs"
                readOnly
                value={reveal.accessToken}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              Curl example
              <input
                className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs"
                readOnly
                value={reveal.curlExample}
              />
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
                onClick={copyToken}
                type="button"
              >
                Copy to clipboard
              </button>
              <button
                className="rounded-md border border-line px-4 py-2 text-sm font-semibold"
                onClick={() => setReveal(null)}
                type="button"
              >
                I&apos;ve saved this
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RouteTableRow({
  domainHost,
  editingRouteId,
  onEdit,
  onMakePrivate,
  onRemoveToken,
  onRotateToken,
  onToast,
  onUpdateRoute,
  isPro,
  maxTimeoutSeconds,
  route
}: {
  domainHost: string;
  editingRouteId: string | null;
  onEdit: (routeId: string | null) => void;
  onMakePrivate: () => void;
  onRemoveToken: () => void;
  onRotateToken: () => void;
  onToast: (toast: Toast) => void;
  onUpdateRoute: (routeId: string, update: Partial<RouteRow>) => void;
  isPro: boolean;
  maxTimeoutSeconds: number;
  route: RouteRow;
}) {
  const isPrivate = Boolean(route.accessTokenHash);
  const isEditing = editingRouteId === route.id;
  const timeoutSeconds = Math.round(route.timeoutMs / 1000);
  const timeoutUnit = timeoutSeconds >= 60 && timeoutSeconds % 60 === 0 ? "m" : "s";

  return (
    <>
      <tr className="border-t border-line align-top">
        <td className="py-3 pr-3 font-mono text-xs">
          <a className="underline-offset-2 hover:underline" href={routeUrl(domainHost, route.pathPrefix)}>
            {route.pathPrefix}
          </a>
          <p className="mt-2 text-[11px] font-sans text-muted">Streaming enabled</p>
        </td>
        <td className="py-3 pr-3 font-mono text-xs">{route.targetPort}</td>
        <td className="py-3 pr-3">{route.agent?.name ?? "unassigned"}</td>
        <td className="py-3 pr-3">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
              isPrivate ? "bg-foreground text-background" : "bg-surface text-muted"
            }`}
          >
            <LockIcon locked={isPrivate} />
            {isPrivate ? `Private · ...${route.accessTokenHint}` : "Public"}
          </span>
        </td>
        <td className="py-3 pr-3">
          {isEditing ? (
            <TimeoutEditor
              initialUnit={timeoutUnit}
              initialValue={String(timeoutUnit === "m" ? timeoutSeconds / 60 : timeoutSeconds)}
              onCancel={() => onEdit(null)}
              onCommit={async (timeoutMs) => {
                const previous = route.timeoutMs;
                onEdit(null);
                onUpdateRoute(route.id, { timeoutMs });

                const response = await fetch(`/api/routes/${route.id}/timeout`, {
                  method: "PATCH",
                  headers: {
                    "content-type": "application/json"
                  },
                  body: JSON.stringify({ timeoutMs })
                });

                if (!response.ok) {
                  const body = (await response.json().catch(() => null)) as { error?: string } | null;
                  onUpdateRoute(route.id, { timeoutMs: previous });
                  onToast({ tone: "error", message: body?.error ?? "Could not update timeout" });
                  return;
                }

                onToast({ tone: "success", message: "Timeout updated" });
              }}
              maxTimeoutSeconds={maxTimeoutSeconds}
              pathPrefix={route.pathPrefix}
            />
          ) : (
            <button
              aria-label={`Edit timeout for ${route.pathPrefix}`}
              className="rounded-md px-2 py-1 font-mono text-xs hover:bg-surface focus:bg-surface"
              onClick={() => onEdit(route.id)}
              title={
                isPro
                  ? "Time to first byte. Streaming responses can run indefinitely after the first byte."
                  : "Free routes support up to 60s. Pro routes support up to 10m."
              }
              type="button"
            >
              {formatTimeout(route.timeoutMs)}
            </button>
          )}
        </td>
        <td className="py-3 pr-3">{route.isEnabled ? "yes" : "no"}</td>
        <td className="py-3">
          <details className="relative">
            <summary
              aria-label={`Actions for route ${route.pathPrefix}`}
              className="inline-flex cursor-pointer list-none rounded-md border border-line px-2 py-1 text-sm"
            >
              ...
            </summary>
            <div className="absolute right-0 z-10 mt-1 grid min-w-44 rounded-md border border-line bg-card p-1 shadow-lg">
              {isPrivate ? (
                <>
                  <button
                    className="rounded px-3 py-2 text-left text-sm hover:bg-surface"
                    onClick={onRotateToken}
                    type="button"
                  >
                    Rotate token
                  </button>
                  <button
                    className="rounded px-3 py-2 text-left text-sm hover:bg-surface"
                    onClick={onRemoveToken}
                    type="button"
                  >
                    Remove token
                  </button>
                </>
              ) : (
                <button
                  className="rounded px-3 py-2 text-left text-sm hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!isPro}
                  onClick={onMakePrivate}
                  title={isPro ? undefined : "Private route tokens require Pro"}
                  type="button"
                >
                  {isPro ? "Make private" : "Make private (Pro)"}
                </button>
              )}
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

function TimeoutEditor({
  initialUnit,
  initialValue,
  maxTimeoutSeconds,
  onCancel,
  onCommit,
  pathPrefix
}: {
  initialUnit: "s" | "m";
  initialValue: string;
  maxTimeoutSeconds: number;
  onCancel: () => void;
  onCommit: (timeoutMs: number) => Promise<void>;
  pathPrefix: string;
}) {
  const [draftValue, setDraftValue] = useState(initialValue);
  const [draftUnit, setDraftUnit] = useState<"s" | "m">(initialUnit);
  const draftSeconds = useMemo(() => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed)) {
      return NaN;
    }
    return draftUnit === "m" ? parsed * 60 : parsed;
  }, [draftUnit, draftValue]);
  const isDraftValid =
    !Number.isNaN(draftSeconds) &&
    draftSeconds >= minTimeoutSeconds &&
    draftSeconds <= maxTimeoutSeconds;

  async function commitTimeout() {
    if (!isDraftValid) {
      return;
    }

    const timeoutMs = Math.round(draftSeconds * 1000);
    await onCommit(timeoutMs);
  }

  return (
    <div className="space-y-1">
      <div className="flex w-36 items-center gap-1">
        <input
          aria-label={`Timeout for ${pathPrefix}`}
          className={`w-20 rounded-md border bg-background px-2 py-1 text-sm ${
            isDraftValid ? "border-line" : "border-danger"
          }`}
          onBlur={commitTimeout}
          onChange={(event) => setDraftValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitTimeout();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="60"
          title={`Allowed range: 5s-${maxTimeoutSeconds}s`}
          type="number"
          value={draftValue}
        />
        <select
          aria-label={`Timeout unit for ${pathPrefix}`}
          className="rounded-md border border-line bg-background px-2 py-1 text-sm"
          onChange={(event) => setDraftUnit(event.currentTarget.value as "s" | "m")}
          value={draftUnit}
        >
          <option value="s">s</option>
          <option value="m">m</option>
        </select>
      </div>
      <p className="max-w-52 text-xs leading-5 text-muted">
        Time to first byte. Streaming responses can run indefinitely after the first byte.
      </p>
    </div>
  );
}

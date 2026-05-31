import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

type TunnelStatus = {
  state: string;
  message: string;
  public_url: string | null;
};

type KeepAwakeStatus = {
  enabled: boolean;
  message: string;
};

type RegisterAgentResponse = {
  agentId: string;
  agentName: string;
  agentToken: string;
  relayToken: string;
  relayUrl: string;
};

type Theme = "light" | "dark";

type Project = {
  id: string;
  name: string;
  appUrl: string;
  agentId: string;
  agentApiToken: string;
  relayToken: string;
  relayUrl: string;
  createdAt: number;
};

type TabId = string; // project id, or "new"
const NEW_TAB: TabId = "new";

const initialStatus: TunnelStatus = {
  state: "offline",
  message: "No tunnel is running",
  public_url: null
};

const defaultAppUrl = import.meta.env.VITE_TUNIQ_APP_URL ?? "https://tuniq.dev";

const PROJECTS_KEY = "tuniq.projects.v1";
const OPEN_TABS_KEY = "tuniq.openTabs.v1";
const ACTIVE_TAB_KEY = "tuniq.activeTab.v1";

type SecretField = "agent_api_token" | "relay_token";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function redactForStorage(projects: Project[]): Project[] {
  return projects.map((project) => ({
    ...project,
    agentApiToken: "",
    relayToken: ""
  }));
}

async function saveSecret(projectId: string, field: SecretField, value: string) {
  if (value.trim().length === 0) {
    await invoke("secret_delete", { projectId, field }).catch(() => undefined);
    return;
  }
  await invoke("secret_set", { projectId, field, value }).catch(() => undefined);
}

async function loadSecret(projectId: string, field: SecretField): Promise<string> {
  const value = await invoke<string | null>("secret_get", { projectId, field }).catch(() => null);
  return value ?? "";
}

function FolderPlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="tab-icon-svg"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M12 11v5" />
      <path d="M9.5 13.5h5" />
    </svg>
  );
}

function CirclePlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="tab-add-svg"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <span className="theme-icon" aria-hidden="true">
      <svg className={theme === "light" ? "icon-sun active" : "icon-sun"} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
      <svg className={theme === "dark" ? "icon-moon active" : "icon-moon"} viewBox="0 0 24 24">
        <path d="M20.1 14.4a7.7 7.7 0 0 1-10.5-10.5 8.7 8.7 0 1 0 10.5 10.5Z" />
      </svg>
    </span>
  );
}

function createProjectId() {
  return `proj_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function App() {
  const [theme, setTheme] = useState<Theme>("light");
  const [projects, setProjects] = useState<Project[]>(() => loadJSON<Project[]>(PROJECTS_KEY, []));
  const [openTabs, setOpenTabs] = useState<TabId[]>(() => {
    const stored = loadJSON<TabId[]>(OPEN_TABS_KEY, []);
    return stored.length > 0 ? stored : [NEW_TAB];
  });
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const stored = loadJSON<TabId>(ACTIVE_TAB_KEY, NEW_TAB);
    return stored || NEW_TAB;
  });

  const [enrollAppUrl, setEnrollAppUrl] = useState(defaultAppUrl);
  const [enrollToken, setEnrollToken] = useState("");
  const [enrollName, setEnrollName] = useState("");
  const [enrollState, setEnrollState] = useState<"idle" | "pending" | "error">("idle");
  const [enrollError, setEnrollError] = useState("");

  const [keepAwake, setKeepAwake] = useState<KeepAwakeStatus>({
    enabled: false,
    message: "Computer sleep prevention is off"
  });
  const [statuses, setStatuses] = useState<Record<string, TunnelStatus>>({});
  const [actionError, setActionError] = useState("");

  const activeProject = useMemo(
    () => (activeTab === NEW_TAB ? null : projects.find((p) => p.id === activeTab) ?? null),
    [activeTab, projects]
  );

  // Theme bootstrap
  useEffect(() => {
    const storedTheme = window.localStorage.getItem("tuniq.theme");
    const initialTheme: Theme =
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(initialTheme);

    invoke<Record<string, TunnelStatus>>("tunnel_statuses")
      .then(setStatuses)
      .catch(() => undefined);

    if (window.localStorage.getItem("tuniq.keepAwake") === "true") {
      updateKeepAwake(true);
      return;
    }

    invoke<KeepAwakeStatus>("keep_awake_status")
      .then(setKeepAwake)
      .catch(() => undefined);
  }, []);

  // Theme apply
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("tuniq.theme", theme);
  }, [theme]);

  // Hydrate tokens from Keychain on first load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = loadJSON<Project[]>(PROJECTS_KEY, []);
      if (stored.length === 0) return;
      const hydrated = await Promise.all(
        stored.map(async (project) => ({
          ...project,
          agentApiToken: await loadSecret(project.id, "agent_api_token"),
          relayToken: await loadSecret(project.id, "relay_token")
        }))
      );
      if (!cancelled) setProjects(hydrated);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist tab state (with secrets redacted; tokens live in Keychain)
  useEffect(() => {
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(redactForStorage(projects)));
  }, [projects]);
  useEffect(() => {
    window.localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabs));
  }, [openTabs]);
  useEffect(() => {
    window.localStorage.setItem(ACTIVE_TAB_KEY, JSON.stringify(activeTab));
  }, [activeTab]);

  // Poll all tunnel statuses periodically
  useEffect(() => {
    const tick = () => {
      invoke<Record<string, TunnelStatus>>("tunnel_statuses")
        .then(setStatuses)
        .catch(() => undefined);
    };
    const interval = window.setInterval(tick, 3_000);
    return () => window.clearInterval(interval);
  }, []);

  // Heartbeat for active project
  useEffect(() => {
    if (!activeProject?.agentId || !activeProject.agentApiToken) {
      return;
    }
    const send = async () => {
      await fetch(`${activeProject.appUrl.replace(/\/+$/, "")}/api/agent/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: activeProject.agentId,
          agentToken: activeProject.agentApiToken,
          version: "0.1.0"
        })
      }).catch(() => undefined);
    };
    send();
    const interval = window.setInterval(send, 60_000);
    return () => window.clearInterval(interval);
  }, [activeProject?.id, activeProject?.agentId, activeProject?.agentApiToken, activeProject?.appUrl]);

  function updateProject(id: string, patch: Partial<Project>) {
    setProjects((current) => current.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    if (patch.agentApiToken !== undefined) {
      void saveSecret(id, "agent_api_token", patch.agentApiToken);
    }
    if (patch.relayToken !== undefined) {
      void saveSecret(id, "relay_token", patch.relayToken);
    }
  }

  function openProjectTab(projectId: string) {
    setOpenTabs((current) => {
      if (current.includes(projectId)) return current;
      const withoutNew = current.filter((t) => t !== NEW_TAB || activeTab !== NEW_TAB);
      // replace the "new" tab with the project if new is active, otherwise append
      if (activeTab === NEW_TAB) {
        return current.map((t) => (t === NEW_TAB ? projectId : t));
      }
      return [...withoutNew, projectId];
    });
    setActiveTab(projectId);
  }

  function closeTab(tabId: TabId) {
    setOpenTabs((current) => {
      const next = current.filter((t) => t !== tabId);
      if (next.length === 0) {
        next.push(NEW_TAB);
      }
      if (activeTab === tabId) {
        const idx = current.indexOf(tabId);
        const fallback = next[Math.min(idx, next.length - 1)] ?? NEW_TAB;
        setActiveTab(fallback);
      }
      return next;
    });
  }

  function addNewTab() {
    setOpenTabs((current) => (current.includes(NEW_TAB) ? current : [...current, NEW_TAB]));
    setActiveTab(NEW_TAB);
    setEnrollToken("");
    setEnrollName("");
    setEnrollState("idle");
    setEnrollError("");
  }

  function deleteProject(projectId: string) {
    setProjects((current) => current.filter((p) => p.id !== projectId));
    setOpenTabs((current) => {
      const next = current.filter((t) => t !== projectId);
      return next.length > 0 ? next : [NEW_TAB];
    });
    if (activeTab === projectId) {
      setActiveTab(NEW_TAB);
    }
    void invoke("secret_clear_project", { projectId }).catch(() => undefined);
  }

  async function enrollAgent() {
    if (enrollState === "pending") return;
    setEnrollError("");
    setEnrollState("pending");

    try {
      const response = await fetch(`${enrollAppUrl.replace(/\/+$/, "")}/api/agent/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enrollmentToken: enrollToken,
          platform: navigator.platform,
          version: "0.1.0"
        })
      });

      if (!response.ok) {
        const reason =
          response.status === 401
            ? "Enrollment token is invalid or already used. Create a new one in the dashboard."
            : response.status === 410
              ? "Enrollment token expired. Create a new one in the dashboard."
              : `Enrollment failed with ${response.status}`;
        throw new Error(reason);
      }

      const body = (await response.json()) as RegisterAgentResponse;
      const project: Project = {
        id: createProjectId(),
        name: enrollName.trim() || body.agentName,
        appUrl: enrollAppUrl,
        agentId: body.agentId,
        agentApiToken: body.agentToken,
        relayToken: body.relayToken,
        relayUrl: body.relayUrl,
        createdAt: Date.now()
      };

      await Promise.all([
        saveSecret(project.id, "agent_api_token", body.agentToken),
        saveSecret(project.id, "relay_token", body.relayToken)
      ]);

      setProjects((current) => [...current, project]);
      setOpenTabs((current) => {
        if (activeTab === NEW_TAB && current.includes(NEW_TAB)) {
          return current.map((t) => (t === NEW_TAB ? project.id : t));
        }
        return [...current.filter((t) => t !== NEW_TAB), project.id];
      });
      setActiveTab(project.id);
      setEnrollToken("");
      setEnrollName("");
      setEnrollState("idle");
      setStatuses((current) => ({
        ...current,
        [project.agentId]: {
          state: "enrolled",
          message: `${project.name} is enrolled. Start the tunnel when the local service is ready.`,
          public_url: null
        }
      }));
    } catch (caught) {
      setEnrollError(caught instanceof Error ? caught.message : String(caught));
      setEnrollState("error");
    }
  }

  async function startTunnel() {
    if (!activeProject) return;
    setActionError("");
    try {
      const nextStatus = await invoke<TunnelStatus>("start_tunnel", {
        config: {
          relayUrl: activeProject.relayUrl,
          agentId: activeProject.agentId,
          agentToken: activeProject.relayToken
        }
      });
      setStatuses((current) => ({ ...current, [activeProject.agentId]: nextStatus }));
    } catch (caught) {
      setActionError(String(caught));
    }
  }

  async function stopTunnel() {
    if (!activeProject) return;
    setActionError("");
    try {
      const nextStatus = await invoke<TunnelStatus>("stop_tunnel", {
        agentId: activeProject.agentId
      });
      setStatuses((current) => ({ ...current, [activeProject.agentId]: nextStatus }));
    } catch (caught) {
      setActionError(String(caught));
    }
  }

  async function updateKeepAwake(enabled: boolean) {
    setActionError("");
    try {
      const nextStatus = await invoke<KeepAwakeStatus>("set_keep_awake", { enabled });
      window.localStorage.setItem("tuniq.keepAwake", String(nextStatus.enabled));
      setKeepAwake(nextStatus);
    } catch (caught) {
      setActionError(String(caught));
    }
  }

  const frameRef = useRef<HTMLElement | null>(null);
  const tabStripRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const strip = tabStripRef.current;
    if (!frame || !strip) return;
    const update = () => {
      const activeEl = strip.querySelector<HTMLElement>(".tab.is-active");
      if (!activeEl) return;
      const frameRect = frame.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      const center = activeRect.left + activeRect.width / 2 - frameRect.left;
      const pct = (center / frameRect.width) * 100;
      frame.style.setProperty("--active-x", `${pct.toFixed(2)}%`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeTab, openTabs.length]);

  const activeStatus = activeProject
    ? statuses[activeProject.agentId] ?? initialStatus
    : initialStatus;
  const onlineCount = Object.values(statuses).filter((s) => s.state === "online").length;
  const titlebarLabel =
    onlineCount > 0 ? `${onlineCount} online` : activeStatus.state;
  const titlebarOnline = onlineCount > 0;
  const isOnline = activeStatus.state === "online";
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <main className="app-frame" ref={frameRef}>
      <header
        className="app-titlebar"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement;
          if (target.closest("button, input, a, select, textarea, [data-no-drag]")) return;
          getCurrentWindow().startDragging().catch(() => undefined);
        }}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("button, input, a, select, textarea, [data-no-drag]")) return;
          getCurrentWindow().toggleMaximize().catch(() => undefined);
        }}
      >
        <div className="traffic-lights" data-no-drag>
          <button
            aria-label="Close window"
            className="tl tl-close"
            onClick={() => getCurrentWindow().close().catch(() => undefined)}
            type="button"
          >
            <svg viewBox="0 0 8 8" aria-hidden="true">
              <path d="M2 2l4 4M6 2l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            aria-label="Minimize window"
            className="tl tl-min"
            onClick={() => getCurrentWindow().minimize().catch(() => undefined)}
            type="button"
          >
            <svg viewBox="0 0 8 8" aria-hidden="true">
              <path d="M1.5 4h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            aria-label="Toggle maximize window"
            className="tl tl-max"
            onClick={() => getCurrentWindow().toggleMaximize().catch(() => undefined)}
            type="button"
          >
            <svg viewBox="0 0 8 8" aria-hidden="true">
              <path
                d="M2 3.2l1.7-1.7c.1-.1.2-.1.3 0l.2.2c.1.1.1.2 0 .3L2.5 3.7m3.5 1.1L4.3 6.5c-.1.1-.2.1-.3 0l-.2-.2c-.1-.1-.1-.2 0-.3l1.7-1.7"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <div className="brand-lockup">
          <div className="brand-mark">T</div>
          <strong>Tuniq</strong>
        </div>
        <nav className="tab-strip" aria-label="Projects" ref={tabStripRef}>
          {openTabs.map((tabId) => {
            const project = tabId === NEW_TAB ? null : projects.find((p) => p.id === tabId);
            const isActive = tabId === activeTab;
            const label = project ? project.name : "New project";
            const tabStatus = project ? statuses[project.agentId] : undefined;
            const tabOnline = tabStatus?.state === "online";
            return (
              <div
                key={tabId}
                className={`tab${isActive ? " is-active" : ""}${tabId === NEW_TAB ? " is-new" : ""}`}
              >
                <button
                  className="tab-label"
                  type="button"
                  onClick={() => setActiveTab(tabId)}
                  title={project ? project.agentId : "New project"}
                >
                  {tabId === NEW_TAB ? (
                    <span className="tab-icon">
                      <FolderPlusIcon />
                    </span>
                  ) : null}
                  {project ? (
                    <span
                      aria-hidden="true"
                      className={tabOnline ? "tab-dot is-online" : "tab-dot"}
                    />
                  ) : null}
                  {label}
                </button>
                {openTabs.length > 1 ? (
                  <button
                    aria-label={`Close ${label}`}
                    className="tab-close"
                    onClick={() => closeTab(tabId)}
                    type="button"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            aria-label="New project tab"
            className="tab-add"
            onClick={addNewTab}
            type="button"
            title="New tab"
          >
            <CirclePlusIcon />
          </button>
        </nav>
        <div className="titlebar-actions">
          <button
            aria-label={`Switch to ${nextTheme} mode`}
            className="theme-button"
            onClick={() => setTheme(nextTheme)}
            type="button"
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </header>

      {activeProject ? (
        <ProjectView
          project={activeProject}
          status={activeStatus}
          isOnline={isOnline}
          keepAwake={keepAwake}
          actionError={actionError}
          onStart={startTunnel}
          onStop={stopTunnel}
          onKeepAwakeToggle={updateKeepAwake}
          onPatch={(patch) => updateProject(activeProject.id, patch)}
          onDelete={() => deleteProject(activeProject.id)}
        />
      ) : (
        <NewTabView
          projects={projects}
          appUrl={enrollAppUrl}
          name={enrollName}
          token={enrollToken}
          enrollState={enrollState}
          enrollError={enrollError}
          onAppUrlChange={setEnrollAppUrl}
          onNameChange={setEnrollName}
          onTokenChange={(value) => {
            setEnrollToken(value);
            if (enrollState === "error") setEnrollState("idle");
          }}
          onEnroll={enrollAgent}
          onOpen={openProjectTab}
          onDelete={deleteProject}
        />
      )}

      <footer className="status-bar" aria-label="Status">
        <span
          aria-live="polite"
          className={titlebarOnline ? "status-item is-online" : "status-item"}
        >
          <span className="status-dot" aria-hidden="true" />
          {titlebarLabel.toLowerCase()}
        </span>
        {activeProject ? (
          <span className="status-item">
            <span className="status-item-key">agent</span>
            {activeProject.agentId.slice(-8) || "—"}
          </span>
        ) : null}
        <span className="status-spacer" />
        <span className="status-item">
          <span className="status-item-key">mcp</span>
          127.0.0.1:38789
        </span>
      </footer>
    </main>
  );
}

function ProjectView({
  project,
  status,
  isOnline,
  keepAwake,
  actionError,
  onStart,
  onStop,
  onKeepAwakeToggle,
  onPatch,
  onDelete
}: {
  project: Project;
  status: TunnelStatus;
  isOnline: boolean;
  keepAwake: KeepAwakeStatus;
  actionError: string;
  onStart: () => void;
  onStop: () => void;
  onKeepAwakeToggle: (enabled: boolean) => void;
  onPatch: (patch: Partial<Project>) => void;
  onDelete: () => void;
}) {
  return (
    <section className="content-grid">
      <section className="overview-card">
        <div className="overview-header">
          <div>
            <p className="section-label">Tunnel status</p>
            <h1>{isOnline ? "Forwarding traffic" : "Ready to start"}</h1>
            <p>{status.message}</p>
          </div>
          <div className={isOnline ? "signal-badge online" : "signal-badge"}>
            <span />
          </div>
        </div>

        <div className="route-line" aria-hidden="true">
          <div>
            <span>Web</span>
            <strong>{project.appUrl.replace(/^https?:\/\//, "")}</strong>
          </div>
          <i />
          <div>
            <span>Relay</span>
            <strong>{project.relayUrl.startsWith("ws://localhost") ? "localhost" : "production"}</strong>
          </div>
          <i />
          <div>
            <span>Agent</span>
            <strong>{project.agentId ? project.name : "not enrolled"}</strong>
          </div>
        </div>

        <div className="info-grid">
          <div>
            <span>Agent ID</span>
            <code>{project.agentId || "Not enrolled"}</code>
          </div>
          <div>
            <span>Public URL</span>
            <code>{status.public_url || "Managed in dashboard"}</code>
          </div>
          <div>
            <span>Local MCP</span>
            <code>127.0.0.1:38789/mcp</code>
          </div>
        </div>

        <div className="primary-actions">
          <button className="primary-button" type="button" onClick={onStart}>
            Start tunnel
          </button>
          <button className="secondary-button" type="button" onClick={onStop}>
            Stop
          </button>
        </div>

        {actionError ? <p className="error-banner">{actionError}</p> : null}
      </section>

      <section className="setup-stack">
        <section className="panel-card">
          <div className="panel-heading">
            <span>1</span>
            <div>
              <h2>Project</h2>
              <p>Edit how this enrollment appears in the tab strip.</p>
            </div>
          </div>
          <label>
            Display name
            <input
              value={project.name}
              onChange={(event) => onPatch({ name: event.currentTarget.value })}
            />
          </label>
          <label>
            Tuniq app URL
            <input
              value={project.appUrl}
              onChange={(event) => onPatch({ appUrl: event.currentTarget.value })}
            />
          </label>
        </section>

        <section className="panel-card">
          <div className="panel-heading">
            <span>2</span>
            <div>
              <h2>Relay connection</h2>
              <p>Stored locally after enrollment.</p>
            </div>
          </div>
          <label>
            Relay URL
            <input
              value={project.relayUrl}
              onChange={(event) => onPatch({ relayUrl: event.currentTarget.value })}
            />
          </label>
          <label>
            Agent ID
            <input
              value={project.agentId}
              onChange={(event) => onPatch({ agentId: event.currentTarget.value })}
            />
          </label>
          <label>
            Relay token
            <input
              value={project.relayToken}
              onChange={(event) => onPatch({ relayToken: event.currentTarget.value })}
              type="password"
            />
          </label>
        </section>

        <section className="settings-card">
          <label className="switch-row">
            <span>
              <strong>Keep computer awake</strong>
              <small>{keepAwake.message}</small>
            </span>
            <input
              checked={keepAwake.enabled}
              onChange={(event) => onKeepAwakeToggle(event.currentTarget.checked)}
              type="checkbox"
            />
          </label>
          <label className="token-field">
            Agent API token
            <input
              value={project.agentApiToken}
              onChange={(event) => onPatch({ agentApiToken: event.currentTarget.value })}
              type="password"
            />
          </label>
          <button
            className="danger-link"
            type="button"
            onClick={() => {
              if (window.confirm(`Remove ${project.name}? Tokens stored here will be deleted.`)) {
                onDelete();
              }
            }}
          >
            Remove this project
          </button>
        </section>
      </section>
    </section>
  );
}

function NewTabView({
  projects,
  appUrl,
  name,
  token,
  enrollState,
  enrollError,
  onAppUrlChange,
  onNameChange,
  onTokenChange,
  onEnroll,
  onOpen,
  onDelete
}: {
  projects: Project[];
  appUrl: string;
  name: string;
  token: string;
  enrollState: "idle" | "pending" | "error";
  enrollError: string;
  onAppUrlChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onEnroll: () => void;
  onOpen: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}) {
  const canEnroll = enrollState !== "pending" && token.trim().length > 0;

  return (
    <section className="new-tab-view">
      <div className="new-tab-inner">
        <header className="new-tab-header">
          <p className="section-label">New tab</p>
          <h1>Pick a project or enroll a new one</h1>
          <p className="new-tab-sub">
            Each project is one enrollment — tokens persist locally so you can switch
            between them without re-enrolling.
          </p>
        </header>

        <section className="new-tab-section">
          <div className="new-tab-section-heading">
            <h2>Saved projects</h2>
            <span className="muted-pill">{projects.length}</span>
          </div>
          {projects.length === 0 ? (
            <p className="empty-line">No saved projects yet. Enroll one below to get started.</p>
          ) : (
            <ul className="project-list">
              {projects.map((project) => (
                <li className="project-row" key={project.id}>
                  <button
                    className="project-row-main"
                    onClick={() => onOpen(project.id)}
                    type="button"
                  >
                    <span className="project-row-mark">{project.name.charAt(0).toUpperCase()}</span>
                    <span className="project-row-text">
                      <strong>{project.name}</strong>
                      <small>{project.agentId}</small>
                    </span>
                    <span className="project-row-cta">Open</span>
                  </button>
                  <button
                    aria-label={`Remove ${project.name}`}
                    className="project-row-delete"
                    onClick={() => {
                      if (window.confirm(`Remove ${project.name}? Tokens stored here will be deleted.`)) {
                        onDelete(project.id);
                      }
                    }}
                    type="button"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="new-tab-section">
          <div className="new-tab-section-heading">
            <h2>Enroll a new project</h2>
          </div>
          <div className="enroll-card">
            <label>
              Project name
              <input
                value={name}
                onChange={(event) => onNameChange(event.currentTarget.value)}
                placeholder="gimme-job"
              />
            </label>
            <label>
              Tuniq app URL
              <input
                value={appUrl}
                onChange={(event) => onAppUrlChange(event.currentTarget.value)}
              />
            </label>
            <label>
              Enrollment token
              <input
                value={token}
                onChange={(event) => onTokenChange(event.currentTarget.value)}
                placeholder="enroll_..."
                type="password"
              />
            </label>
            <button
              className="primary-button full-width"
              disabled={!canEnroll}
              onClick={onEnroll}
              type="button"
            >
              {enrollState === "pending" ? "Enrolling..." : "Enroll project"}
            </button>
            {enrollState === "error" && enrollError ? (
              <p className="error-banner">{enrollError}</p>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}

export default App;

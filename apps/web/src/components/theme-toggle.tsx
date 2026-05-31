"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem("tuniq.theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getThemeSnapshot(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  const currentTheme = document.documentElement.dataset.theme;
  if (currentTheme === "light" || currentTheme === "dark") {
    return currentTheme;
  }

  return getInitialTheme();
}

function subscribeToThemeChanges(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("tuniq-theme-change", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("tuniq-theme-change", onStoreChange);
  };
}

function setDocumentTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem("tuniq.theme", theme);
  window.dispatchEvent(new Event("tuniq-theme-change"));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToThemeChanges, getThemeSnapshot, () => "light");
  const isDark = theme === "dark";

  return (
    <button
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={isDark}
      className="group relative grid h-9 w-9 place-items-center overflow-hidden rounded-md border border-line bg-surface text-foreground transition hover:bg-card focus:outline-none focus:ring-2 focus:ring-accent/30"
      onClick={() => setDocumentTheme(isDark ? "light" : "dark")}
      type="button"
    >
      <svg
        aria-hidden="true"
        className={`absolute h-4 w-4 transition duration-500 ${
          isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        } group-hover:rotate-180`}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
      <svg
        aria-hidden="true"
        className={`absolute h-4 w-4 transition duration-500 ${
          isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
        } group-hover:-rotate-180`}
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M20.1 14.4a7.7 7.7 0 0 1-10.5-10.5 8.7 8.7 0 1 0 10.5 10.5Z" />
      </svg>
    </button>
  );
}

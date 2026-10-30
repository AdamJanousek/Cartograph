"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "./theme-script";

type Theme = "system" | "light" | "dark";

const THEMES: Theme[] = ["system", "light", "dark"];

function readStored(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  // Another tab changing the theme updates this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    apply(readStored());
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, readStored, () => "system");

  // React's dev-only remount strips attributes it doesn't own from <html>,
  // including the one the head script set. A no-op in production.
  useLayoutEffect(() => apply(readStored()), []);

  function choose(next: Theme) {
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice still applies, it just won't persist.
    }
    apply(next);
    listeners.forEach((listener) => listener());
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex h-6 items-center rounded border border-border p-px"
    >
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => choose(option)}
          className="h-full rounded-[3px] px-1.5 text-[11px] text-text-muted aria-pressed:bg-surface-raised aria-pressed:text-text"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

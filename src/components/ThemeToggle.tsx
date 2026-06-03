"use client";

import * as React from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage blocked
  }
  // First visit — start from the user's OS preference so we don't surprise them.
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<Theme>("light");
  const [mounted, setMounted] = React.useState(false);

  // Initialise from localStorage / OS preference after mount.
  React.useEffect(() => {
    setTheme(getInitialTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage blocked
    }
    document.documentElement.dataset.theme = next;
  }

  // Render a placeholder until mounted to avoid hydration mismatch flicker.
  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle theme"
        className="p-2 text-page-text hover:text-baby-blue-eyes transition-colors"
      >
        <Sun size={20} />
      </button>
    );
  }

  const label =
    theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  const Icon = theme === "light" ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="p-2 text-page-text hover:text-baby-blue-eyes transition-colors"
    >
      <Icon size={20} />
    </button>
  );
}

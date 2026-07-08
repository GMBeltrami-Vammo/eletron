"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const CYCLE = ["system", "light", "dark"] as const;

const LABEL: Record<(typeof CYCLE)[number], string> = {
  system: "Tema: sistema",
  light: "Tema: claro",
  dark: "Tema: escuro",
};

/** Cycles system → light → dark. Mounted-guard avoids the hydration flash. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current = (CYCLE as readonly string[]).includes(theme ?? "")
    ? (theme as (typeof CYCLE)[number])
    : "system";

  const Icon = !mounted
    ? Monitor
    : current === "light"
      ? Sun
      : current === "dark"
        ? Moon
        : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label="Alternar tema"
      title={mounted ? LABEL[current] : "Tema"}
      disabled={!mounted}
      onClick={() => {
        const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
        setTheme(next);
      }}
    >
      <Icon className="size-4" strokeWidth={2} />
    </Button>
  );
}

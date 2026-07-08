"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useState } from "react";

import { NAV_ITEMS, type NavBadgeCounts } from "@/components/vammo/nav-items";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/vammo/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function MobileNav({ counts }: { counts?: NavBadgeCounts }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-card px-4 py-2 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={<Button variant="ghost" size="icon" aria-label="Menu" />}
        >
          <Menu className="size-5" strokeWidth={2} />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="flex items-center gap-2">
              <Image
                src="/vammo-logo-black.svg"
                alt="Vammo"
                width={72}
                height={13}
                className="h-auto w-[72px] dark:invert"
              />
              <span className="text-sm font-semibold">Eletron</span>
            </SheetTitle>
          </SheetHeader>
          <nav className="px-2 py-2">
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              const count = item.badgeKey ? counts?.[item.badgeKey] : undefined;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <item.icon className="size-4" strokeWidth={2} />
                  <span className="flex-1">{item.label}</span>
                  {count !== undefined && count > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--badge-red-bg)] px-1.5 text-[11px] font-semibold leading-5 text-[var(--badge-red-text)] tabular-nums">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
      <Image
        src="/vammo-logo-black.svg"
        alt="Vammo"
        width={72}
        height={13}
        className="h-auto w-[72px] dark:invert"
      />
      <span className="text-sm font-semibold">Eletron</span>
      <ThemeToggle className="ml-auto" />
    </header>
  );
}

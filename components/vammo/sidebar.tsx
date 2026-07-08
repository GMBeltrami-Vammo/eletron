"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

import { NAV_ITEMS, type NavBadgeCounts } from "@/components/vammo/nav-items";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/vammo/theme-toggle";
import { cn } from "@/lib/utils";

type SidebarUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export function AppSidebar({
  user,
  counts,
  onSignOut,
}: {
  user: SidebarUser;
  counts?: NavBadgeCounts;
  onSignOut: () => Promise<void>;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      {/* NavLogo lockup */}
      <div className="flex items-center gap-3 px-4 py-4">
        <Image
          src="/vammo-logo-black.svg"
          alt="Vammo"
          width={84}
          height={15}
          className="h-auto w-[84px] dark:invert"
          priority
        />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight text-sidebar-foreground">
            Eletron
          </div>
          <div className="truncate text-xs text-muted-foreground">
            Swap stations
          </div>
        </div>
      </div>

      {/* NavMain */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const count = item.badgeKey ? counts?.[item.badgeKey] : undefined;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="size-4 shrink-0" strokeWidth={2} />
              <span className="flex-1 truncate">{item.label}</span>
              {count !== undefined && count > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--badge-red-bg)] px-1.5 text-[11px] font-semibold leading-5 text-[var(--badge-red-text)] tabular-nums">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* NavUser */}
      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-3">
        <Avatar className="size-8">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback className="text-xs">
            {(user.name ?? user.email ?? "?")
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-sidebar-foreground">
            {user.name ?? "—"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {user.email ?? ""}
          </div>
        </div>
        <ThemeToggle className="size-8 text-muted-foreground" />
        <form action={onSignOut}>
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            title="Sair"
          >
            <LogOut className="size-4" strokeWidth={2} />
          </Button>
        </form>
      </div>
    </aside>
  );
}

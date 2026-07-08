import {
  BatteryCharging,
  Bell,
  CalendarRange,
  Camera,
  FileCheck,
  Home,
  Inbox,
  Receipt,
  Settings2,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** key into the badge-counts object served by the layout */
  badgeKey?: "revisao" | "alertas";
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/estacoes", label: "Estações", icon: BatteryCharging },
  { href: "/energia", label: "Energia", icon: Zap },
  { href: "/alugueis", label: "Aluguéis", icon: Home },
  { href: "/mensal", label: "Mensal", icon: CalendarRange },
  { href: "/pagamentos", label: "Pagamentos", icon: Receipt },
  { href: "/comprovantes", label: "Comprovantes", icon: FileCheck },
  { href: "/leituras", label: "Leituras", icon: Camera },
  { href: "/revisao", label: "Revisão", icon: Inbox, badgeKey: "revisao" },
  { href: "/alertas", label: "Alertas", icon: Bell, badgeKey: "alertas" },
  { href: "/admin", label: "Configurações", icon: Settings2 },
];

export type NavBadgeCounts = Partial<Record<"revisao" | "alertas", number>>;

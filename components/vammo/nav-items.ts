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
  SignalHigh,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** key into the badge-counts object served by the layout */
  badgeKey?: "revisao" | "alertas" | "pagamentos";
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/estacoes", label: "Estações", icon: BatteryCharging },
  { href: "/energia", label: "Energia", icon: Zap },
  { href: "/alugueis", label: "Aluguéis", icon: Home },
  { href: "/mensal", label: "Mensal", icon: CalendarRange },
  // pagamentos badge = documentos de e-mail pendentes de análise (#47)
  { href: "/pagamentos", label: "Pagamentos", icon: Receipt, badgeKey: "pagamentos" },
  { href: "/comprovantes", label: "Comprovantes", icon: FileCheck },
  { href: "/leituras", label: "Leituras", icon: Camera },
  { href: "/revisao", label: "Revisão", icon: Inbox, badgeKey: "revisao" },
  { href: "/alertas", label: "Alertas", icon: Bell, badgeKey: "alertas" },
  { href: "/arqia", label: "Arqia", icon: SignalHigh },
  { href: "/admin", label: "Configurações", icon: Settings2 },
];

export type NavBadgeCounts = Partial<
  Record<"revisao" | "alertas" | "pagamentos", number>
>;

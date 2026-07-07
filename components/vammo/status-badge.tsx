import { cn } from "@/lib/utils";

/**
 * The vammo-ui BackOffice 10-color badge palette (see globals.css tokens).
 * Color choice conventions in eletron:
 *   green = pago/ativo · red = vencida/erro · yellow = pendente ·
 *   blue = info/a vencer · orange = atenção · grey = neutro/sem dados ·
 *   dark-green = concluído histórico · black = decomissionada
 */
export type BadgeColor =
  | "black"
  | "grey"
  | "blue"
  | "green"
  | "red"
  | "yellow"
  | "brown"
  | "orange"
  | "white"
  | "dark-green";

export function StatusBadge({
  color,
  children,
  outline = false,
  className,
}: {
  color: BadgeColor;
  children: React.ReactNode;
  outline?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        outline && "border bg-transparent",
        className,
      )}
      style={
        outline
          ? {
              borderColor: `var(--badge-${color}-bg)`,
              color: `var(--badge-${color}-bg)`,
            }
          : {
              backgroundColor: `var(--badge-${color}-bg)`,
              color: `var(--badge-${color}-text)`,
            }
      }
    >
      {children}
    </span>
  );
}

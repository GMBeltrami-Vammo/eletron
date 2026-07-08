import { StatusBadge } from "@/components/vammo/status-badge";
import { CHARGE_FLAG_UI } from "./flags";

/**
 * Renders a charge's gerar_mes/pipeline flags as badges (shared by the Gerar
 * mês preview and the ledger rows created from it). `alreadyExists` adds the
 * preview-only grey "Já existe" (skip) chip.
 */
export function FlagBadges({
  flags,
  alreadyExists = false,
}: {
  flags: string[];
  alreadyExists?: boolean;
}) {
  if (flags.length === 0 && !alreadyExists) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {alreadyExists ? (
        <StatusBadge color="grey" outline>
          Já existe
        </StatusBadge>
      ) : null}
      {flags.map((flag) => {
        const ui = CHARGE_FLAG_UI[flag];
        return ui ? (
          <span key={flag} title={ui.description}>
            <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
          </span>
        ) : (
          <StatusBadge key={flag} color="grey" outline>
            {flag}
          </StatusBadge>
        );
      })}
    </div>
  );
}

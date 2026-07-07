"use client";

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface FacetOption {
  value: string;
  label: string;
}

/** Multiselect facet dropdown for table toolbars (spec §2C filter bar). */
export function FacetFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="h-9 bg-card" />}
      >
        {label}
        {selected.length > 0 ? (
          <span className="rounded bg-muted px-1 text-xs tabular-nums">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="size-4" strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selected, option.value]
                  : selected.filter((v) => v !== option.value),
              )
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

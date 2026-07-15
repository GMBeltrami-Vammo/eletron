"use client";

/**
 * Masked dd/MM/aaaa date field (Gabriel 2026-07-14: "datas sempre em dd/MM/aaaa").
 * A drop-in for <input type="date"> — same value contract (ISO 'yyyy-MM-dd' or
 * ''), but it ALWAYS displays dd/MM/aaaa regardless of the browser locale (the
 * native picker follows the browser UI language, which we can't control). Emits
 * the ISO value only once a complete, real calendar date is typed; '' otherwise.
 */

import * as React from "react";

import { Input } from "./input";
import { brToIsoDate, isoToBrDate, maskBrDate } from "@/lib/date-mask";

export function DateField({
  value,
  onValueChange,
  id,
  className,
  disabled,
  placeholder = "dd/mm/aaaa",
  min,
  max,
  invalid,
}: {
  /** ISO 'yyyy-MM-dd' (or '') — same as a native date input. */
  value: string;
  onValueChange: (iso: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /** ISO bounds — a complete date outside [min,max] is treated as invalid (emits ''). */
  min?: string;
  max?: string;
  invalid?: boolean;
}) {
  const [text, setText] = React.useState(() => isoToBrDate(value));
  // Track the last ISO we emitted so an external value change (reset/seed)
  // re-syncs the visible text, but our own keystrokes don't clobber it.
  const lastIso = React.useRef(value);
  React.useEffect(() => {
    if (value !== lastIso.current) {
      setText(isoToBrDate(value));
      lastIso.current = value;
    }
  }, [value]);

  return (
    <Input
      id={id}
      className={className}
      disabled={disabled}
      inputMode="numeric"
      autoComplete="off"
      aria-invalid={invalid}
      placeholder={placeholder}
      maxLength={10}
      value={text}
      onChange={(e) => {
        const masked = maskBrDate(e.target.value);
        setText(masked);
        let iso = brToIsoDate(masked) ?? "";
        // out-of-range complete date → treat as invalid (mirrors native min/max)
        if (iso && ((min && iso < min) || (max && iso > max))) iso = "";
        lastIso.current = iso;
        onValueChange(iso);
      }}
    />
  );
}

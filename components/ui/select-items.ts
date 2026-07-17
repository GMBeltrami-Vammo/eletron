import * as React from "react";

/**
 * Base UI's `Select.Value` renders the raw `value` in the trigger unless the
 * Root gets an `items` map (source: resolveValueLabel.js → fallback = raw
 * value). Without it every enum select showed e.g. "aluguel_energia" in the
 * closed trigger while the open list showed "Aluguel e energia" (Gabriel
 * 2026-07-17). The Select wrapper walks its `SelectItem` descendants and hands
 * Base UI a `{ value: label }` map so the trigger shows the label.
 *
 * SelectItem elements are identified by `displayName` (set in select.tsx) so
 * this stays a pure, JSX-free module the vitest suite can import (the .tsx
 * component can't be imported under Next's `jsx: preserve`).
 */
export const SELECT_ITEM_DISPLAY_NAME = "SelectItem";

function isSelectItemType(type: unknown): boolean {
  return (
    typeof type === "function" &&
    (type as { displayName?: string }).displayName === SELECT_ITEM_DISPLAY_NAME
  );
}

export function collectSelectItems(
  children: React.ReactNode,
): Record<string, React.ReactNode> {
  const map: Record<string, React.ReactNode> = {};
  const walk = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as {
        value?: unknown;
        children?: React.ReactNode;
      };
      if (isSelectItemType(child.type)) {
        // SelectItem children ARE the label; never descend into them.
        if (typeof props.value === "string") map[props.value] = props.children;
        return;
      }
      if (props?.children != null) walk(props.children);
    });
  };
  walk(children);
  return map;
}

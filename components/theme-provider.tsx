"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Mounted in the ROOT layout (not the (app) group) so /login is themed too.
 * Class strategy: next-themes stamps `.dark` on <html>; tokens live in
 * globals.css.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

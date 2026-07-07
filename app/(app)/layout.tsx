import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Providers } from "@/components/providers";
import { AppSidebar } from "@/components/vammo/sidebar";
import { MobileNav } from "@/components/vammo/mobile-nav";
import { Toaster } from "@/components/ui/sonner";

import { signOutAction } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <Providers>
      <div className="flex min-h-svh bg-background">
        <AppSidebar
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          }}
          onSignOut={signOutAction}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
      <Toaster position="top-right" />
    </Providers>
  );
}

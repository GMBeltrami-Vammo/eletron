import Image from "next/image";

import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Image
            src="/vammo-logo-black.svg"
            alt="Vammo"
            width={120}
            height={32}
            className="mb-2 dark:invert"
            priority
          />
          <CardTitle>Eletron</CardTitle>
          <CardDescription>
            Visibilidade financeira das swap stations. Acesso restrito a contas
            @vammo.com.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/estacoes" });
            }}
          >
            <Button type="submit" className="w-full">
              Entrar com Google
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

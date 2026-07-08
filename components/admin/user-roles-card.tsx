"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuditByline } from "@/components/vammo/audit-byline";
import { StatusBadge } from "@/components/vammo/status-badge";
import { setUserRole } from "@/app/actions/admin";
import type { AdminTableResult, UserRoleRow } from "./admin-data";

type Role = "admin" | "operator";

const ROLE_UI: Record<Role, { label: string; color: "orange" | "blue" }> = {
  admin: { label: "Admin", color: "orange" },
  operator: { label: "Operador", color: "blue" },
};

const VAMMO_EMAIL = /^[^@\s]+@vammo\.com$/;

type PendingChange = {
  email: string;
  role: Role | null;
  description: string;
} | null;

export function UserRolesCard({
  data,
}: {
  data: AdminTableResult<UserRoleRow>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<PendingChange>(null);
  const [newEmail, setNewEmail] = React.useState("");
  const [newRole, setNewRole] = React.useState<Role>("operator");
  const [busy, startTransition] = React.useTransition();

  function apply(email: string, role: Role | null, done?: () => void) {
    startTransition(async () => {
      const res = await setUserRole({ email, role });
      if (res.ok) {
        toast.success(
          role === null
            ? `Acesso de ${email} removido.`
            : `${email} agora é ${ROLE_UI[role].label.toLowerCase()}.`,
        );
        setPending(null);
        done?.();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function addUser() {
    const email = newEmail.trim().toLowerCase();
    if (!z.string().regex(VAMMO_EMAIL).safeParse(email).success) {
      toast.error("Informe um e-mail @vammo.com válido.");
      return;
    }
    apply(email, newRole, () => setNewEmail(""));
  }

  if (!data.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usuários e papéis</CardTitle>
          <CardDescription>
            Gerencie quem pode escrever (operador) e administrar (admin).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Indisponível — requer o backend Supabase configurado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuários e papéis</CardTitle>
        <CardDescription>
          Operador pode registrar pagamentos e alertas; admin também gerencia
          papéis e remapeamentos. Restrito a contas @vammo.com.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Última alteração</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-16 text-center text-sm text-muted-foreground"
                  >
                    Nenhum papel cadastrado.
                  </TableCell>
                </TableRow>
              ) : (
                data.rows.map((r) => (
                  <TableRow key={r.email}>
                    <TableCell className="py-2 text-sm font-medium">
                      {r.email}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge color={ROLE_UI[r.role].color}>
                          {ROLE_UI[r.role].label}
                        </StatusBadge>
                        <Select
                          value={r.role}
                          onValueChange={(v) => {
                            const role = v as Role;
                            if (role !== r.role) {
                              setPending({
                                email: r.email,
                                role,
                                description: `Alterar ${r.email} para ${ROLE_UI[role].label.toLowerCase()}?`,
                              });
                            }
                          }}
                        >
                          <SelectTrigger size="sm" className="bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="operator">Operador</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <AuditByline actorEmail={r.actorEmail} at={r.at} />
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setPending({
                            email: r.email,
                            role: null,
                            description: `Remover o acesso de ${r.email}? Ele deixa de poder escrever.`,
                          })
                        }
                      >
                        Remover
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Adicionar usuário */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="new-user-email">Adicionar usuário</Label>
            <Input
              id="new-user-email"
              type="email"
              inputMode="email"
              placeholder="pessoa@vammo.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-user-role">Papel</Label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
              <SelectTrigger id="new-user-role" className="w-36 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">Operador</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addUser} disabled={busy || newEmail.trim() === ""}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <UserPlus className="size-4" strokeWidth={2} />
            )}
            Adicionar
          </Button>
        </div>
      </CardContent>

      <Dialog
        open={pending !== null}
        onOpenChange={(o) => (o ? null : setPending(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar alteração de papel</DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button
              variant={pending?.role === null ? "destructive" : "default"}
              disabled={busy}
              onClick={() =>
                pending && apply(pending.email, pending.role)
              }
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

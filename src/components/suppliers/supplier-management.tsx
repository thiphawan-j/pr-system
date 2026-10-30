"use client";

import Link from "@/components/loading/navigation-link";
import { useAppRouter as useRouter } from "@/components/loading/use-app-router";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SupplierDetail, SupplierListPage } from "@/lib/types";

export function SupplierManagement({ data, query, status }: { data: SupplierListPage; query: string; status: string }) {
  const router = useRouter();
  const { dictionary } = useI18n();
  const labels = dictionary.suppliers;
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierDetail | null>(null);
  const [isPending, setIsPending] = useState(false);
  function href(page: number) { return `/suppliers?${new URLSearchParams({ query, status, page: String(page) })}`; }
  function open(supplier: SupplierDetail | null) { setEditing(supplier); setIsOpen(true); }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (router.isPending) return;
    const values = new FormData(event.currentTarget);
    router.push(`/suppliers?${new URLSearchParams({ query: String(values.get("query") ?? ""), status: String(values.get("status") ?? "ALL"), page: "1" })}`);
  }
  return (
    <>
      <div className="flex justify-end"><Button id="create-supplier" type="button" disabled={!mounted || router.isPending} onClick={() => open(null)}>{labels.create}</Button></div>
      <Card className="border-border/70"><CardContent className="pt-4">
        <form className="grid gap-4 sm:grid-cols-[1fr_auto_auto]" onSubmit={search}>
          <div className="space-y-2"><Label htmlFor="supplier-query">{labels.search}</Label><Input id="supplier-query" name="query" defaultValue={query} maxLength={200} /></div>
          <div className="space-y-2"><Label htmlFor="supplier-status">{dictionary.common.status}</Label><select id="supplier-status" name="status" defaultValue={status} className="h-8 rounded-lg border border-input bg-background px-3 text-sm"><option value="ALL">{labels.all}</option><option value="ACTIVE">{labels.active}</option><option value="INACTIVE">{labels.inactive}</option></select></div>
          <Button type="submit" className="self-end" loading={router.isPending} loadingKind="navigation">{dictionary.common.search}</Button>
        </form>
      </CardContent></Card>
      <Card className="border-border/70"><CardContent className="pt-4">
        {data.items.length ? <Table>
          <TableHeader><TableRow><TableHead>{labels.code}</TableHead><TableHead>{labels.name}</TableHead><TableHead>{labels.channels}</TableHead><TableHead>{dictionary.common.status}</TableHead><TableHead>{dictionary.common.actions}</TableHead></TableRow></TableHeader>
          <TableBody>{data.items.map((supplier) => <TableRow key={supplier.id}>
            <TableCell className="font-medium">{supplier.code}</TableCell>
            <TableCell className="whitespace-normal"><p>{supplier.name}</p>{supplier.contactPerson ? <p className="text-xs text-muted-foreground">{supplier.contactPerson}</p> : null}</TableCell>
            <TableCell className="whitespace-normal">{supplier.contacts.map((contact) => <p key={contact.channel} className="break-words text-sm">{labels[contact.channel]}: {contact.value}</p>)}</TableCell>
            <TableCell><Badge variant="outline">{supplier.isActive ? labels.active : labels.inactive}</Badge></TableCell>
            <TableCell><Button type="button" variant="outline" size="sm" disabled={!mounted || router.isPending} aria-label={`${dictionary.common.edit} ${supplier.code}`} onClick={() => open(supplier)}>{dictionary.common.edit}</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <p className="py-8 text-center text-muted-foreground">{labels.empty}</p>}
      </CardContent></Card>
      <nav aria-label={labels.page} className="flex items-center justify-between gap-3">
        {data.page > 1 ? <Button id="supplier-previous-page" asChild variant="outline"><Link href={href(data.page - 1)}>{labels.previous}</Link></Button> : <Button id="supplier-previous-page" disabled variant="outline">{labels.previous}</Button>}
        <p className="text-sm text-muted-foreground">{labels.page} {data.page} / {Math.max(1, data.totalPages)} · {data.totalCount}</p>
        {data.page < data.totalPages ? <Button id="supplier-next-page" asChild variant="outline"><Link href={href(data.page + 1)}>{labels.next}</Link></Button> : <Button id="supplier-next-page" disabled variant="outline">{labels.next}</Button>}
      </nav>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!isPending) setIsOpen(open); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={false}>
          <DialogHeader><DialogTitle>{editing ? `${labels.edit} · ${editing.code}` : labels.create}</DialogTitle><DialogDescription>{labels.description}</DialogDescription></DialogHeader>
          {isOpen ? <SupplierForm key={editing ? `${editing.id}-${editing.version}` : "create"} supplier={editing} onPendingChange={setIsPending} onReloaded={(supplier) => { setEditing(supplier); router.refresh(); }} onSaved={() => { setIsOpen(false); toast.success(labels.saved); router.refresh(); }} /> : null}
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setIsOpen(false)}>{labels.close}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

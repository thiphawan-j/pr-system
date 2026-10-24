import { redirect } from "next/navigation";

import { SupplierManagement } from "@/components/suppliers/supplier-management";
import { supplierListPageSize } from "@/lib/constants";
import { isPurchasing } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { listSuppliersPage } from "@/server/suppliers/supplier.service";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, dictionary, raw] = await Promise.all([requireSession(), getCurrentDictionary(), searchParams]);
  if (!isPurchasing(session)) redirect("/dashboard");
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const query = (first(raw.query) ?? "").trim().slice(0, 200);
  const statusValue = first(raw.status);
  const status = statusValue === "ACTIVE" || statusValue === "INACTIVE" ? statusValue : "ALL";
  const pageValue = Number(first(raw.page) ?? 1);
  const page = Number.isInteger(pageValue) && pageValue > 0 && pageValue <= 10000 ? pageValue : 1;
  const data = await listSuppliersPage(session, { query, status, page, limit: supplierListPageSize });
  return <div className="space-y-6"><div className="space-y-2"><h1 className="text-3xl font-semibold tracking-tight">{dictionary.suppliers.title}</h1><p className="text-muted-foreground">{dictionary.suppliers.description}</p></div><SupplierManagement data={data} query={query} status={status} /></div>;
}

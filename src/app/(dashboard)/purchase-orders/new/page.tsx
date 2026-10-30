import { notFound, redirect } from "next/navigation";

import { PurchaseOrderRequestPicker } from "@/components/purchase-orders/purchase-order-request-picker";
import { isPurchasing } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { listPurchaseOrderRecipients } from "@/server/purchase-orders/purchase-order-recipient";
import { listActiveSuppliers } from "@/server/suppliers/supplier.service";
import { getPurchaseRequestById } from "@/server/purchase-requests/purchase-request.service";
import { isAppError } from "@/server/shared/errors";

export default async function NewCombinedPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ requestId?: string }> }) {
  const [session, dictionary] = await Promise.all([requireSession(), getCurrentDictionary()]);
  if (!isPurchasing(session)) redirect("/purchase-requests");
  const [suppliers, recipients] = await Promise.all([listActiveSuppliers(session), listPurchaseOrderRecipients(session)]);
  const { requestId } = await searchParams;
  const source = typeof requestId === "string" ? await getPurchaseRequestById(requestId, session).catch((error: unknown) => {
    if (isAppError(error) && (error.statusCode === 403 || error.statusCode === 404)) notFound();
    throw error;
  }) : null;
  const pendingCount = source?.items.filter((item) => item.canOrder !== false).length ?? 0;
  const initialRequest = source && ["APPROVED", "ORDERED"].includes(source.status) && !source.completedAt && !source.hasPendingPurchaseOrderChange && pendingCount > 0 ? {
    id: source.id, prNumber: source.prNumber, department: source.department, requesterName: source.requester.name, orderableItemCount: pendingCount, updatedAt: source.updatedAt,
  } : undefined;
  return <div className="min-w-0 space-y-6">
    <div className="space-y-2"><h1 className="text-3xl font-semibold tracking-tight">{dictionary.poCombined.title}</h1><p className="text-muted-foreground">{dictionary.poCombined.description}</p></div>
    <PurchaseOrderRequestPicker suppliers={suppliers} recipients={recipients} initialRequest={initialRequest} />
  </div>;
}

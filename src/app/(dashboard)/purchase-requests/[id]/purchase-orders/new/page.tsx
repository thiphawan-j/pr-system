import { notFound, redirect } from "next/navigation";

import { PurchaseOrderForm } from "@/components/purchase-orders/purchase-order-form";
import { isPurchasing } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { getPurchaseRequestById } from "@/server/purchase-requests/purchase-request.service";
import { isAppError } from "@/server/shared/errors";
import { listActiveSuppliers } from "@/server/suppliers/supplier.service";

export default async function NewPurchaseOrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const [session, dictionary] = await Promise.all([requireSession(), getCurrentDictionary()]);
  const { id } = await params;
  const request = await getPurchaseRequestById(id, session).catch((error: unknown) => {
    if (isAppError(error) && (error.statusCode === 403 || error.statusCode === 404)) notFound();
    throw error;
  });
  if (!isPurchasing(session) || request.status !== "APPROVED") {
    redirect(`/purchase-requests/${request.id}`);
  }
  const suppliers = await listActiveSuppliers(session);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{dictionary.purchaseOrders.createTitle} · {request.prNumber}</h1>
        <p className="text-muted-foreground">{dictionary.purchaseOrders.createDescription}</p>
      </div>
      <PurchaseOrderForm request={request} suppliers={suppliers} />
    </div>
  );
}

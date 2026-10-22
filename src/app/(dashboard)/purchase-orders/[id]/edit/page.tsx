import { notFound, redirect } from "next/navigation";

import { PurchaseOrderEditForm } from "@/components/purchase-orders/purchase-order-edit-form";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { getPurchaseOrderById } from "@/server/purchase-orders/purchase-order.service";
import { isAppError } from "@/server/shared/errors";
import { listActiveSuppliers } from "@/server/suppliers/supplier.service";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [session, dictionary] = await Promise.all([requireSession(), getCurrentDictionary()]);
  const { id } = await params;
  const order = await getPurchaseOrderById(id, session).catch((error: unknown) => {
    if (isAppError(error) && (error.statusCode === 403 || error.statusCode === 404)) notFound();
    throw error;
  });
  if (!order.canEdit) redirect(`/purchase-orders/${order.id}`);
  const suppliers = await listActiveSuppliers(session);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{dictionary.poChanges.title} · {order.poNumber}</h1>
        <p className="text-muted-foreground">{dictionary.poChanges.description}</p>
      </div>
      <PurchaseOrderEditForm key={order.version} order={order} suppliers={suppliers} />
    </div>
  );
}

import { redirect } from "next/navigation";

import { PurchaseRequestForm } from "@/components/purchase-requests/purchase-request-form";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";
import { getPurchaseRequestById } from "@/server/purchase-requests/purchase-request.service";

export default async function EditPurchaseRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [session, dictionary] = await Promise.all([
    requireSession(),
    getCurrentDictionary(),
  ]);
  const { id } = await params;
  const request = await getPurchaseRequestById(id, session);

  if (
    request.status !== "DRAFT" ||
    (request.requester.id !== session.id && session.role !== "ADMIN")
  ) {
    redirect(`/purchase-requests/${id}`);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {dictionary.purchaseRequests.editTitle}
        </h1>
        <p className="text-muted-foreground">
          {dictionary.purchaseRequests.editDescription}
        </p>
      </div>

      <PurchaseRequestForm
        mode="edit"
        session={session}
        requestId={id}
        initialData={request}
      />
    </div>
  );
}

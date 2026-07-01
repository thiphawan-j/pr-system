import { PurchaseRequestForm } from "@/components/purchase-requests/purchase-request-form";
import { requireSession } from "@/server/auth/session";
import { getCurrentDictionary } from "@/server/i18n";

export default async function CreatePurchaseRequestPage() {
  const [session, dictionary] = await Promise.all([
    requireSession(),
    getCurrentDictionary(),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {dictionary.purchaseRequests.createTitle}
        </h1>
        <p className="text-muted-foreground">
          {dictionary.purchaseRequests.createDescription}
        </p>
      </div>

      <PurchaseRequestForm mode="create" session={session} />
    </div>
  );
}

import { ExpiredLinkIllustration } from "@/components/purchase-orders/expired-link-illustration";
import { getDictionary } from "@/lib/i18n";

export default function SharedPurchaseOrderNotFound() {
  const thai = getDictionary("th").sharePurchaseOrder;
  const english = getDictionary("en").sharePurchaseOrder;

  return <main className="flex min-h-svh items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
    <section aria-labelledby="shared-po-unavailable-title" className="w-full max-w-xl rounded-[2rem] border border-border/70 bg-card/95 px-6 py-8 text-center shadow-xl shadow-black/5 sm:px-10 sm:py-10">
      <p className="mx-auto w-fit rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-primary">PR Flow</p>
      <ExpiredLinkIllustration className="mx-auto my-5 h-auto w-full max-w-72 sm:max-w-80" />
      <div className="space-y-2">
        <h1 id="shared-po-unavailable-title" lang="th" className="text-2xl font-semibold tracking-tight sm:text-3xl">{thai.publicUnavailableTitle}</h1>
        <p lang="en" className="text-lg font-medium text-primary">{english.publicUnavailableTitle}</p>
      </div>
      <div aria-hidden="true" className="mx-auto my-5 h-1 w-10 rounded-full bg-primary/25" />
      <div className="mx-auto max-w-md space-y-3">
        <p lang="th" className="text-sm leading-7 text-muted-foreground sm:text-base">{thai.publicUnavailableDescription}</p>
        <p lang="en" className="text-sm leading-6 text-muted-foreground">{english.publicUnavailableDescription}</p>
      </div>
    </section>
  </main>;
}

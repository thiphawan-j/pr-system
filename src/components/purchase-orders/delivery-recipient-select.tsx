"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Label } from "@/components/ui/label";
import { getDepartmentLabelFromDictionary } from "@/lib/i18n";
import type { PurchaseOrderRecipientOption } from "@/lib/types";

export function DeliveryRecipientSelect({ id, value, recipients, disabled, storedRecipient, onChange }: {
  id: string;
  value: string;
  recipients: PurchaseOrderRecipientOption[];
  disabled?: boolean;
  storedRecipient?: { id: string | null; name: string };
  onChange: (value: string) => void;
}) {
  const { dictionary } = useI18n();
  const labels = dictionary.purchaseOrders;
  const unavailableRecipient = storedRecipient && !recipients.some((recipient) => recipient.id === storedRecipient.id)
    ? storedRecipient : undefined;

  return <div className="min-w-0 space-y-2">
    <Label htmlFor={id}>{labels.deliveryRecipient}</Label>
    <select id={id} value={value} disabled={disabled} aria-describedby={`${id}-hint`}
      className="h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      onChange={(event) => onChange(event.target.value)}>
      <option value="" disabled={Boolean(unavailableRecipient && !unavailableRecipient.id)}>
        {unavailableRecipient && !unavailableRecipient.id ? unavailableRecipient.name : labels.selectDeliveryRecipient}
      </option>
      {unavailableRecipient?.id ? <option value={unavailableRecipient.id} disabled>{unavailableRecipient.name}</option> : null}
      {recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>
        {recipient.name} · {recipient.employeeCode} · {getDepartmentLabelFromDictionary(recipient.department, dictionary)}
      </option>)}
    </select>
    <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{labels.deliveryRecipientHint}</p>
  </div>;
}

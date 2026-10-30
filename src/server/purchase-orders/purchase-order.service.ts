import "server-only";

import { Prisma } from "@prisma/client";
import { calculatePurchaseOrderPricing } from "@/lib/purchase-order-tax";
import { toBangkokDateValue, toBangkokIsoString } from "@/lib/format";
import type { PurchaseOrderDetail, PurchaseOrderSnapshot, SessionUser } from "@/lib/types";
import { isPurchasing } from "@/server/auth/authorization";
import { companyIdentitySchema } from "@/server/company/company.schemas";
import { getDb } from "@/server/db";
import { assertCanViewOrderSources, canReviewOrderSources, orderSources } from "@/server/purchase-orders/purchase-order-access";
import { AppError } from "@/server/shared/errors";
import { supplierContactSchema } from "@/server/suppliers/supplier.schemas";
import { z } from "zod";

export { convertPurchaseRequestToOrders, combinePurchaseRequestsToOrders, listPurchaseOrderCandidates } from "./purchase-order-creation.service";

export async function getPurchaseOrderById(id: string, session: SessionUser): Promise<PurchaseOrderDetail> {
  const sourceSelect = {
    id: true, prNumber: true, requesterId: true, department: true, currentApproverId: true,
    status: true, receiptVersion: true, receivedAt: true, requester: { select: { name: true } },
    purchaseOrders: { where: { status: "ISSUED", changes: { some: { status: "PENDING" } } }, select: { id: true }, take: 1 },
    approvals: { where: { action: "APPROVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { approverId: true } },
  } satisfies Prisma.PurchaseRequestSelect;
  const order = await getDb().purchaseOrder.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      purchaseRequest: { select: sourceSelect },
      purchaseRequests: { select: sourceSelect, orderBy: { id: "asc" } },
      cancelledBy: { select: { id: true, name: true } },
      items: { orderBy: { position: "asc" }, include: { _count: { select: { receiptItems: true } } } },
      changes: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: {
        submittedBy: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } },
      } },
    },
  });
  if (!order) throw new AppError("ไม่พบเอกสาร PO ที่ต้องการ", 404);
  const source = order.purchaseRequest;
  const sources = orderSources(order);
  assertCanViewOrderSources(session, sources);
  const contacts = z.array(supplierContactSchema).safeParse(order.supplierContacts);
  const buyerCompany = companyIdentitySchema.safeParse(order.buyerCompany);
  const pending = order.changes.find((change) => change.status === "PENDING");
  const reviewable = order.status === "ISSUED" && sources.every((request) => request.status === "ORDERED" || request.status === "COMPLETED");
  const active = reviewable && sources.some((request) => request.status === "ORDERED" && !request.receivedAt);
  const canCancel = order.status === "ISSUED" && isPurchasing(session) && !pending
    && sources.every((request) => request.status === "ORDERED" || request.status === "COMPLETED"
      && order.items.every((item) => item.sourcePurchaseRequestId !== request.id))
    && order.items.every((item) => item.receivedQuantity === 0 && item.closedQuantity === 0 && item._count.receiptItems === 0);
  const sourceDetails = sources.map((request) => ({
    id: request.id, prNumber: request.prNumber, department: request.department,
    requesterName: request.requester.name, requesterId: request.requesterId, status: request.status, receiptVersion: request.receiptVersion,
    canCloseOrder: sources.length === 1 && order.status === "ISSUED" && isPurchasing(session)
      && request.status === "ORDERED" && request.purchaseOrders.length === 0,
  }));
  const tax = calculatePurchaseOrderPricing(order.items.map((item) => ({ amount: item.amount.toString(), taxMode: item.taxMode, discountType: item.discountType, discountValue: Number(item.discountValue) })), order.taxMode, Number(order.vatRate), { discountType: order.discountType, discountValue: Number(order.discountValue) });
  const hasDiscountMetadata = order.discountType !== "NONE" || !order.discountValue.equals(0) || order.items.some((item) => item.discountType !== "NONE" || !item.discountValue.equals(0) || !item.orderDiscountAmount.equals(0));
  const hasTaxMetadata = hasDiscountMetadata || order.taxMode !== "UNSPECIFIED" || !order.vatRate.equals(7) || order.items.some((item) => item.taxMode !== null);
  return {
    ...(hasTaxMetadata ? { taxMode: order.taxMode, vatRate: Number(order.vatRate), subtotalAmount: tax.subtotalAmount, netAmount: tax.netAmount, taxAmount: tax.taxAmount, hasUnspecifiedTax: tax.hasUnspecifiedTax } : {}),
    ...(hasDiscountMetadata ? { discountType: order.discountType, discountValue: Number(order.discountValue), itemDiscountAmount: tax.itemDiscountAmount, orderDiscountAmount: tax.orderDiscountAmount, discountAmount: tax.discountAmount, discountedSubtotalAmount: tax.discountedSubtotalAmount } : {}),
    buyerCompany: buyerCompany.success ? buyerCompany.data : null,
    status: order.status, canCancel,
    cancelledAt: order.cancelledAt ? toBangkokIsoString(order.cancelledAt) : null,
    cancellationReason: order.cancellationReason, cancellationReference: order.cancellationReference,
    cancelledBy: order.cancelledBy,
    version: order.version, revision: order.revision,
    canEdit: active && isPurchasing(session) && !pending,
    canReview: reviewable && Boolean(pending) && pending?.submittedById !== session.id && canReviewOrderSources(session, sources),
    canWithdraw: reviewable && pending?.submittedById === session.id,
    pendingChangeId: pending?.id ?? null,
    changes: order.changes.map((change) => ({
      id: change.id, status: change.status, baseVersion: change.baseVersion,
      reason: change.reason, reviewComment: change.reviewComment,
      createdAt: toBangkokIsoString(change.createdAt), reviewedAt: change.reviewedAt ? toBangkokIsoString(change.reviewedAt) : null,
      submittedBy: change.submittedBy, reviewedBy: change.reviewedBy,
      before: change.before as unknown as PurchaseOrderSnapshot, after: change.after as unknown as PurchaseOrderSnapshot,
    })),
    supplierId: order.supplierId,
    supplierCode: order.supplierCode,
    supplierTaxId: order.supplierTaxId,
    supplierContactPerson: order.supplierContactPerson,
    supplierContacts: contacts.success ? contacts.data : [],
    id: order.id, poNumber: order.poNumber, supplierName: order.supplierName,
    issuedAt: toBangkokIsoString(order.issuedAt), totalAmount: Number(order.totalAmount), itemCount: order.items.length,
    supplierAddress: order.supplierAddress, supplierContact: order.supplierContact,
    deliveryAddress: order.deliveryAddress, paymentTerms: order.paymentTerms,
    deliveryRecipientId: order.deliveryRecipientId, deliveryRecipientName: order.deliveryRecipientName,
    deliveryRecipientPhone: order.deliveryRecipientPhone,
    expectedDeliveryDate: order.expectedDeliveryDate ? toBangkokDateValue(order.expectedDeliveryDate) : null,
    note: order.note, createdBy: order.createdBy,
    purchaseRequests: sourceDetails,
    purchaseRequest: {
      id: source.id, prNumber: source.prNumber, department: source.department, requesterName: source.requester.name, requesterId: source.requesterId, status: source.status,
      receiptVersion: source.receiptVersion,
      canCloseOrder: sources.length === 1 && order.status === "ISSUED" && isPurchasing(session) && source.status === "ORDERED" && source.purchaseOrders.length === 0,
    },
    items: order.items.map((item, index) => {
      const line = tax.lines[index]!;
      return {
        id: item.id, purchaseRequestItemId: item.purchaseRequestItemId,
        sourcePurchaseRequestId: item.sourcePurchaseRequestId,
        sourcePrNumber: sources.find((request) => request.id === item.sourcePurchaseRequestId)?.prNumber,
        itemName: item.itemName, description: item.description, quantity: item.quantity, unit: item.unit,
        unitPrice: Number(item.unitPrice), amount: Number(item.amount),
        ...(hasTaxMetadata ? {
          taxMode: item.taxMode, effectiveTaxMode: item.taxMode ?? order.taxMode, vatRate: Number(order.vatRate),
          netAmount: line.netAmount, taxAmount: line.taxAmount, totalWithTax: line.totalAmount,
        } : {}),
        ...(hasDiscountMetadata ? { discountType: item.discountType, discountValue: Number(item.discountValue), orderDiscountAmount: line.orderDiscountAmount, itemDiscountAmount: line.itemDiscountAmount, discountAmount: line.discountAmount, discountedAmount: line.discountedAmount } : {}),
        receivedQuantity: item.receivedQuantity, closedQuantity: item.closedQuantity,
      };
    }),
  };
}

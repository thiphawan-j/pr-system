import "server-only";

import { ApprovalAction, NotificationType, Prisma, PurchaseRequestStatus, type PurchaseRequestItem, type PurchasePriceTaxMode, type PurchaseDiscountType } from "@prisma/client";
import { calculatePurchaseOrderPricing, calculateTaxLine } from "@/lib/purchase-order-tax";
import { toBangkokDateValue, toBangkokIsoString, toBangkokMonthValue } from "@/lib/format";
import type { PurchaseOrderDetail, PurchaseOrderSnapshot, PurchaseOrderSummary, SessionUser } from "@/lib/types";
import { canApprovePurchaseRequest, isPurchasing } from "@/server/auth/authorization";
import { companyIdentitySchema } from "@/server/company/company.schemas";
import { companyIdentity, lockCompanyProfile } from "@/server/company/company.service";
import { getDb } from "@/server/db";
import { createNotifications } from "@/server/notifications/notification.service";
import type { PurchaseOrderConversionInput } from "@/server/purchase-orders/purchase-order.schemas";
import { assertCanViewPurchaseRequest } from "@/server/purchase-requests/purchase-request.service";
import { AppError, invariant } from "@/server/shared/errors";
import { supplierContactSchema } from "@/server/suppliers/supplier.schemas";
import { formatSupplierCode } from "@/server/suppliers/supplier.service";
import { z } from "zod";

const maximumPreparationAmount = new Prisma.Decimal("9999999999.99");

type PreparedConversionItem = {
  clientId: string;
  sourceItemId?: string;
  itemName: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  taxMode: PurchasePriceTaxMode | null;
  discountType: PurchaseDiscountType;
  discountValue: Prisma.Decimal;
  orderDiscountAmount: Prisma.Decimal;
};

function prepareConversionItems(input: PurchaseOrderConversionInput, originals: PurchaseRequestItem[]) {
  if (!input.items) return null;
  const sourceIds = new Set(originals.map((item) => item.id));
  const originalsById = new Map(originals.map((item) => [item.id, item]));
  const retainedSourceIds = input.items.flatMap((item) => item.sourceItemId ? [item.sourceItemId] : []);
  invariant(retainedSourceIds.every((itemId) => sourceIds.has(itemId)), "ไม่พบรายการสินค้าใน PR นี้", 400);
  invariant(new Set(retainedSourceIds).size === retainedSourceIds.length &&
    new Set(input.items.map((item) => item.clientId)).size === input.items.length,
  "รายการสินค้าซ้ำกัน", 400);
  // An approved, unissued PR normally has no receipt activity. Keep this guard
  // explicit so preparation can never discard an existing receiving ledger.
  invariant(originals.every((item) => item.receivedQuantity === 0 && item.closedQuantity === 0),
    "ไม่สามารถปรับรายการก่อนออก PO ของ PR ที่มีการรับสินค้าหรือปิดยอดแล้ว", 400);
  let total = new Prisma.Decimal(0);
  const items: PreparedConversionItem[] = input.items.map((item) => {
    const original = item.sourceItemId ? originalsById.get(item.sourceItemId) : undefined;
    const unitPrice = new Prisma.Decimal(item.unitPrice);
    // Older PRs can have an authoritative stored line amount without a unit
    // price. Changing a discount or description must not erase that amount.
    const amount = original && original.quantity === item.quantity && (original.unitPrice ?? new Prisma.Decimal(0)).equals(unitPrice)
      ? original.amount : unitPrice.times(item.quantity);
    invariant(amount.lte(maximumPreparationAmount), "ยอดเงินมากเกินขอบเขตที่รองรับ", 400);
    total = total.plus(amount);
    return {
      clientId: item.clientId, sourceItemId: item.sourceItemId,
      itemName: item.itemName, description: item.description ?? null,
      quantity: item.quantity, unit: item.unit ?? null, unitPrice, amount, taxMode: item.taxMode ?? null,
      discountType: item.discountType ?? original?.discountType ?? "NONE",
      discountValue: new Prisma.Decimal(item.discountType === "NONE" ? 0 : item.discountValue ?? original?.discountValue ?? 0),
      orderDiscountAmount: new Prisma.Decimal(0),
    };
  });
  invariant(total.lte(maximumPreparationAmount), "ยอดรวม PR มากเกินขอบเขตที่รองรับ", 400);
  return { items, total };
}

function preparationItemSummary(item: Pick<PurchaseRequestItem, "itemName" | "description" | "quantity" | "unit" | "unitPrice" | "amount"> & { taxMode?: PurchasePriceTaxMode | null; vatRate?: Prisma.Decimal; discountType?: PurchaseDiscountType; discountValue?: Prisma.Decimal; orderDiscountAmount?: Prisma.Decimal }) {
  const mode = item.taxMode ?? "UNSPECIFIED";
  const rate = Number(item.vatRate ?? 7);
  const tax = calculateTaxLine(item.amount.toString(), mode, rate, { discountType: item.discountType ?? "NONE", discountValue: Number(item.discountValue ?? 0), orderDiscountAmount: Number(item.orderDiscountAmount ?? 0) });
  return [
    `ชื่อสินค้า: ${item.itemName}`,
    `รายละเอียด: ${item.description ?? "—"}`,
    `จำนวน: ${item.quantity}`,
    `หน่วย: ${item.unit ?? "—"}`,
    `ราคาต่อหน่วย: ${item.unitPrice ? `${item.unitPrice.toFixed(2)} บาท` : "ไม่ได้ระบุ"}`,
    `ยอดรวม: ${item.amount.toFixed(2)} บาท`,
    ...(item.discountType && item.discountType !== "NONE" || !new Prisma.Decimal(item.orderDiscountAmount ?? 0).equals(0) ? [
      `ส่วนลดรายการ: ${(item.discountValue ?? new Prisma.Decimal(0)).toFixed(2)} ${item.discountType === "PERCENT" ? "%" : "บาท"}`,
      `ส่วนลดทั้งใบที่จัดสรร: ${(item.orderDiscountAmount ?? new Prisma.Decimal(0)).toFixed(2)} บาท`,
    ] : []),
    `รูปแบบภาษี: ${taxModeLabel(mode)}`, `อัตรา VAT: ${rate.toFixed(2)}%`,
    `ยอดสุทธิ: ${tax.netAmount === null ? "ไม่ได้ระบุ" : `${tax.netAmount.toFixed(2)} บาท`}`,
    `VAT: ${tax.taxAmount === null ? "ไม่ได้ระบุ" : `${tax.taxAmount.toFixed(2)} บาท`}`,
    `ยอดชำระ: ${tax.totalAmount.toFixed(2)} บาท`,
  ].join(" | ");
}

function taxModeLabel(mode: PurchasePriceTaxMode) {
  return { UNSPECIFIED: "ไม่ได้ระบุ", INCLUSIVE: "รวม VAT แล้ว", EXCLUSIVE: "ยังไม่รวม VAT", NONE: "ไม่มี VAT" }[mode];
}

function preparationAuditComment(originals: PurchaseRequestItem[], items: Array<PreparedConversionItem & { vatRate?: Prisma.Decimal }>, beforeTotal: Prisma.Decimal, afterTotal: Prisma.Decimal) {
  const byId = new Map(originals.map((item) => [item.id, item]));
  const retainedIds = new Set(items.flatMap((item) => item.sourceItemId ? [item.sourceItemId] : []));
  const changes: string[] = [];
  for (const original of originals) {
    if (!retainedIds.has(original.id)) changes.push(`ลบสินค้า: ${preparationItemSummary(original)}`);
  }
  for (const item of items) {
    const original = item.sourceItemId ? byId.get(item.sourceItemId) : undefined;
    if (!original) {
      changes.push(`เพิ่มสินค้า: ${preparationItemSummary(item)}`);
    } else if (original.itemName !== item.itemName || original.description !== item.description ||
      original.quantity !== item.quantity || original.unit !== item.unit ||
      !(original.unitPrice ?? new Prisma.Decimal(0)).equals(item.unitPrice) || !original.amount.equals(item.amount) ||
      original.taxMode !== (item.taxMode ?? "UNSPECIFIED") || !original.vatRate.equals(item.vatRate ?? 7) ||
      original.discountType !== item.discountType || !original.discountValue.equals(item.discountValue) || !original.orderDiscountAmount.equals(item.orderDiscountAmount)) {
      changes.push(`แก้ไขสินค้า\nก่อน: ${preparationItemSummary(original)}\nหลัง: ${preparationItemSummary(item)}`);
    }
  }
  if (!changes.length && beforeTotal.equals(afterTotal)) return null;
  return [`ปรับรายการก่อนออก PO โดยฝ่ายจัดซื้อ`,
    `ยอดรวม PR: ${beforeTotal.toFixed(2)} → ${afterTotal.toFixed(2)} บาท`,
    `ยอดรวม PO: ${afterTotal.toFixed(2)} บาท`, ...changes].join("\n");
}

export async function convertPurchaseRequestToOrders(
  id: string,
  session: SessionUser,
  input: PurchaseOrderConversionInput,
): Promise<PurchaseOrderSummary[]> {
  invariant(isPurchasing(session), "เฉพาะฝ่ายจัดซื้อเท่านั้นที่ดำเนินการได้", 403);
  const db = getDb();
  const issuedAt = new Date();
  const { purchaseOrders, request } = await db.$transaction(async (transaction) => {
    await lockCompanyProfile(transaction, "shared");
    // Use the same PR row lock as receipts, cancellations, and PO amendments.
    // A second submission must read the committed status and item snapshot.
    await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "PurchaseRequest" WHERE "id" = ${id} FOR UPDATE`);
    const company = await transaction.companyProfile.findUnique({ where: { id: "default" } });
    const request = await transaction.purchaseRequest.findUnique({
      where: { id },
      include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, purchaseOrders: { select: { id: true } } },
    });
    invariant(request, "ไม่พบเอกสาร PR ที่ต้องการ", 404);
    invariant(request.purchaseOrders.length === 0, "PR นี้ถูกแปลงเป็น PO แล้ว กรุณาโหลดข้อมูลใหม่", 409);
    invariant(request.status === PurchaseRequestStatus.APPROVED, "PR ต้องได้รับการอนุมัติก่อนแปลงเป็น PO", 400);
    invariant(!(input.items || input.orders.some((order) => order.taxMode !== undefined || order.vatRate !== undefined || order.discountType !== undefined || order.discountValue !== undefined)) || input.expectedUpdatedAt, "กรุณาโหลดข้อมูล PR ใหม่ก่อนแก้ไขรายการ", 400);
    if (input.expectedUpdatedAt) {
      invariant(new Date(input.expectedUpdatedAt).getTime() === request.updatedAt.getTime(),
        "ข้อมูล PR มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    }

    const prepared = prepareConversionItems(input, request.items);
    const allocatedIds = input.orders.flatMap((order) => order.itemIds);
    const sourceIds = new Set(prepared ? prepared.items.map((item) => item.clientId) : request.items.map((item) => item.id));
    invariant(
      allocatedIds.length === sourceIds.size && new Set(allocatedIds).size === sourceIds.size && allocatedIds.every((itemId) => sourceIds.has(itemId)),
      "กรุณาจัดผู้ขายให้ครบทุกรายการใน PR โดยไม่ซ้ำกัน", 400,
    );

    // Serialize conversion against cancellation, returns, and another conversion.
    // The timestamp also prevents issuing an older snapshot after a revision cycle.
    const updated = await transaction.purchaseRequest.updateMany({
      where: { id, status: PurchaseRequestStatus.APPROVED, updatedAt: request.updatedAt, purchaseOrders: { none: {} } },
      data: { status: PurchaseRequestStatus.ORDERED, orderedAt: issuedAt },
    });
    invariant(updated.count === 1, "สถานะเอกสารมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);

    const supplierIds = [...new Set(input.orders.flatMap((order) => "supplierId" in order ? [order.supplierId] : []))].sort();
    if (supplierIds.length) {
      // Master updates lock the supplier before replacing its contacts. Lock
      // suppliers in a stable order so every issued PO captures one committed
      // version of its header, activation state, and contact channels together.
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Supplier"
        WHERE "id" IN (${Prisma.join(supplierIds)}) ORDER BY "id" FOR SHARE
      `);
    }
    const suppliers = supplierIds.length ? await transaction.supplier.findMany({
      where: { id: { in: supplierIds } }, include: { contacts: { orderBy: { channel: "asc" } } },
    }) : [];
    const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    invariant(suppliers.length === supplierIds.length, "ไม่พบผู้ขายที่เลือก กรุณาเลือกผู้ขายใหม่", 400);
    invariant(suppliers.every((supplier) => supplier.isActive), "ผู้ขายที่เลือกถูกปิดใช้งานแล้ว กรุณาเลือกผู้ขายใหม่", 400);

    // Save the final purchasing specification to the PR and PO together.
    // Receiving balances remain on PO lines and are never copied from the PR.
    const conversionItems = request.items.map((item) => ({
      ...item, clientId: item.id, sourceItemId: item.id,
    }));
    if (prepared) {
      const retainedIds = prepared.items.flatMap((item) => item.sourceItemId ? [item.sourceItemId] : []);
      await transaction.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: id, id: { notIn: retainedIds } } });
      const supplierByClientId = new Map(input.orders.flatMap((order) => {
        const name = "supplierId" in order ? suppliersById.get(order.supplierId)!.name : order.supplierName;
        return order.itemIds.map((itemId) => [itemId, name] as const);
      }));
      conversionItems.length = 0;
      for (const item of prepared.items) {
        const fields = {
          itemName: item.itemName, description: item.description, quantity: item.quantity,
          unit: item.unit, unitPrice: item.unitPrice, amount: item.amount,
          supplierName: supplierByClientId.get(item.clientId)!,
          discountType: item.discountType, discountValue: item.discountValue, orderDiscountAmount: new Prisma.Decimal(0),
        };
        const persisted = item.sourceItemId
          ? await transaction.purchaseRequestItem.update({ where: { id: item.sourceItemId }, data: fields })
          : await transaction.purchaseRequestItem.create({ data: { ...fields, purchaseRequestId: id } });
        conversionItems.push({ ...persisted, clientId: item.clientId, sourceItemId: persisted.id });
      }
    }

    const key = toBangkokMonthValue(issuedAt).replace("-", "");
    const sequence = await transaction.purchaseOrderNumberSequence.upsert({
      where: { key },
      create: { key, nextValue: input.orders.length + 1 },
      update: { nextValue: { increment: input.orders.length } },
    });
    const firstNumber = sequence.nextValue - input.orders.length;
    const purchaseOrders: PurchaseOrderSummary[] = [];
    const overridesByClientId = new Map(prepared?.items.map((item) => [item.clientId, item.taxMode]) ?? []);
    const auditedItems: Array<PreparedConversionItem & { vatRate?: Prisma.Decimal }> = [];
    let requestTotal = new Prisma.Decimal(0);
    for (const [index, order] of input.orders.entries()) {
      const registered = "supplierId" in order ? suppliersById.get(order.supplierId)! : null;
      const supplierData = registered ? {
        supplierId: registered.id,
        supplierCode: formatSupplierCode(registered.code),
        supplierName: registered.name,
        supplierAddress: registered.address,
        supplierContact: null,
        supplierTaxId: registered.taxId,
        supplierContactPerson: registered.contactPerson,
        supplierContacts: registered.contacts.map(({ channel, value }) => ({ channel, value })),
        paymentTerms: registered.paymentTerms,
      } : "supplierName" in order ? {
        supplierName: order.supplierName,
        supplierAddress: order.supplierAddress,
        supplierContact: order.supplierContact,
        paymentTerms: order.paymentTerms,
      } : null;
      invariant(supplierData, "กรุณาระบุผู้ขายของทุกรายการ", 400);
      const selectedIds = new Set(order.itemIds);
      const items = conversionItems.filter((item) => selectedIds.has(item.clientId));
      const taxMode = order.taxMode ?? "UNSPECIFIED";
      const vatRate = order.vatRate ?? 7;
      const discountType = order.discountType ?? "NONE";
      const discountValue = order.discountType === "NONE" ? 0 : order.discountValue ?? 0;
      let tax;
      try {
        tax = calculatePurchaseOrderPricing(items.map((item) => ({ amount: item.amount.toString(), taxMode: overridesByClientId.get(item.clientId) ?? null, discountType: item.discountType, discountValue: Number(item.discountValue) })), taxMode, vatRate, { discountType, discountValue });
      } catch {
        throw new AppError("ส่วนลดหรือยอดเงินไม่ถูกต้อง ส่วนลดต้องไม่เกินยอดสินค้าที่เหลือ", 400);
      }
      const totalAmount = new Prisma.Decimal(tax.totalAmount);
      requestTotal = requestTotal.plus(totalAmount);
      invariant(requestTotal.lte(maximumPreparationAmount), "ยอดรวม PR มากเกินขอบเขตที่รองรับ", 400);
      for (const [itemIndex, item] of items.entries()) {
        const effectiveTaxMode = overridesByClientId.get(item.clientId) ?? taxMode;
        const orderDiscountAmount = new Prisma.Decimal(tax.lines[itemIndex]!.orderDiscountAmount);
        await transaction.purchaseRequestItem.update({ where: { id: item.sourceItemId }, data: { taxMode: effectiveTaxMode, vatRate, orderDiscountAmount } });
        auditedItems.push({ ...item, unitPrice: item.unitPrice ?? new Prisma.Decimal(0), taxMode: effectiveTaxMode, vatRate: new Prisma.Decimal(vatRate), orderDiscountAmount });
      }
      const created = await transaction.purchaseOrder.create({
        data: {
          poNumber: `PO-${key}-${String(firstNumber + index).padStart(4, "0")}`,
          purchaseRequestId: id,
          createdById: session.id,
          issuedAt,
          buyerCompany: company ? companyIdentity(company) : Prisma.DbNull,
          ...supplierData,
          deliveryAddress: order.deliveryAddress,
          expectedDeliveryDate: order.expectedDeliveryDate ? new Date(`${order.expectedDeliveryDate}T00:00:00.000Z`) : null,
          note: order.note,
          totalAmount, taxMode, vatRate, discountType, discountValue,
          items: {
            create: items.map((item, position) => ({
              purchaseRequestItemId: item.sourceItemId ?? null,
              position,
              itemName: item.itemName,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice ?? new Prisma.Decimal(0),
              amount: item.amount, taxMode: overridesByClientId.get(item.clientId) ?? null,
              discountType: item.discountType, discountValue: item.discountValue,
              orderDiscountAmount: new Prisma.Decimal(tax.lines[position]!.orderDiscountAmount),
            })),
          },
        },
      });
      purchaseOrders.push({ id: created.id, poNumber: created.poNumber, supplierName: created.supplierName, issuedAt: toBangkokIsoString(created.issuedAt), totalAmount: Number(created.totalAmount), itemCount: items.length });
    }
    await transaction.purchaseRequest.update({ where: { id }, data: { totalAmount: requestTotal } });
    {
      const comment = preparationAuditComment(request.items, auditedItems, request.totalAmount, requestTotal);
      if (comment) {
        await transaction.approval.create({ data: {
          purchaseRequestId: id, approverId: session.id, action: ApprovalAction.COMMENTED,
          stepLabel: "ปรับรายการก่อนออก PO",
          comment: `${purchaseOrders.map((order) => order.poNumber).join(", ")}\n${comment}`,
        } });
      }
    }
    await transaction.approval.create({
      data: { purchaseRequestId: id, approverId: session.id, action: ApprovalAction.ORDERED, stepLabel: "ฝ่ายจัดซื้อ", comment: `แปลง PR เป็น PO: ${purchaseOrders.map((order) => order.poNumber).join(", ")}` },
    });
    return { purchaseOrders, request };
  }, { timeout: 15000 });

  // Issuing POs has already committed. Notification delivery must not make the
  // caller believe issuance failed and encourage an accidental resubmission.
  await createNotifications([{
    userId: request.requesterId,
    title: "ฝ่ายจัดซื้อออกใบสั่งซื้อแล้ว",
    message: `${request.prNumber} ถูกแปลงเป็น ${purchaseOrders.map((order) => order.poNumber).join(", ")}`,
    link: `/purchase-requests/${id}`,
    type: NotificationType.SUCCESS,
  }]).catch((error: unknown) => console.error("[purchase-order-notification]", error));
  return purchaseOrders;
}

export async function getPurchaseOrderById(id: string, session: SessionUser): Promise<PurchaseOrderDetail> {
  const order = await getDb().purchaseOrder.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      purchaseRequest: { select: { id: true, prNumber: true, requesterId: true, department: true, currentApproverId: true, status: true, receiptVersion: true, receivedAt: true, requester: { select: { name: true } },
        purchaseOrders: { where: { changes: { some: { status: "PENDING" } } }, select: { id: true }, take: 1 },
        approvals: { where: { action: "APPROVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { approverId: true } } } },
      items: { orderBy: { position: "asc" } },
      changes: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: {
        submittedBy: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } },
      } },
    },
  });
  if (!order) throw new AppError("ไม่พบเอกสาร PO ที่ต้องการ", 404);
  const source = order.purchaseRequest;
  // The original PR approver still needs the PO and its revision history when
  // reviewing an amendment, including after a department reassignment.
  if (!canApprovePurchaseRequest(session, source.approvals[0]?.approverId)) {
    assertCanViewPurchaseRequest(session, source.requesterId, source.department, source.currentApproverId);
  }
  const contacts = z.array(supplierContactSchema).safeParse(order.supplierContacts);
  const buyerCompany = companyIdentitySchema.safeParse(order.buyerCompany);
  const pending = order.changes.find((change) => change.status === "PENDING");
  const active = source.status === "ORDERED" && !source.receivedAt;
  const reviewable = source.status === "ORDERED";
  const tax = calculatePurchaseOrderPricing(order.items.map((item) => ({ amount: item.amount.toString(), taxMode: item.taxMode, discountType: item.discountType, discountValue: Number(item.discountValue) })), order.taxMode, Number(order.vatRate), { discountType: order.discountType, discountValue: Number(order.discountValue) });
  const hasDiscountMetadata = order.discountType !== "NONE" || !order.discountValue.equals(0) || order.items.some((item) => item.discountType !== "NONE" || !item.discountValue.equals(0) || !item.orderDiscountAmount.equals(0));
  const hasTaxMetadata = hasDiscountMetadata || order.taxMode !== "UNSPECIFIED" || !order.vatRate.equals(7) || order.items.some((item) => item.taxMode !== null);
  return {
    ...(hasTaxMetadata ? { taxMode: order.taxMode, vatRate: Number(order.vatRate), subtotalAmount: tax.subtotalAmount, netAmount: tax.netAmount, taxAmount: tax.taxAmount, hasUnspecifiedTax: tax.hasUnspecifiedTax } : {}),
    ...(hasDiscountMetadata ? { discountType: order.discountType, discountValue: Number(order.discountValue), itemDiscountAmount: tax.itemDiscountAmount, orderDiscountAmount: tax.orderDiscountAmount, discountAmount: tax.discountAmount, discountedSubtotalAmount: tax.discountedSubtotalAmount } : {}),
    buyerCompany: buyerCompany.success ? buyerCompany.data : null,
    version: order.version, revision: order.revision,
    canEdit: active && isPurchasing(session) && !pending,
    canReview: reviewable && Boolean(pending) && pending?.submittedById !== session.id && canApprovePurchaseRequest(session, source.approvals[0]?.approverId),
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
    expectedDeliveryDate: order.expectedDeliveryDate ? toBangkokDateValue(order.expectedDeliveryDate) : null,
    note: order.note, createdBy: order.createdBy,
    purchaseRequest: {
      id: source.id, prNumber: source.prNumber, department: source.department, requesterName: source.requester.name, status: source.status,
      receiptVersion: source.receiptVersion,
      canCloseOrder: isPurchasing(session) && source.status === "ORDERED" && source.purchaseOrders.length === 0,
    },
    items: order.items.map((item, index) => {
      const line = tax.lines[index]!;
      return {
        id: item.id, purchaseRequestItemId: item.purchaseRequestItemId,
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

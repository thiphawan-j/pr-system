import "server-only";
import { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/types";
import { assertRole } from "@/server/auth/authorization";
import { getDb } from "@/server/db";
import { invariant } from "@/server/shared/errors";
import { createProductAliasSchema, createProductSchema, normalizeProductName, productFiltersSchema, type CreateProductAliasInput, type CreateProductInput, type ProductFilters } from "./product.schemas";

const include = { aliases: { orderBy: [{ name: "asc" as const }, { context: "asc" as const }] } };

export async function listProducts(session: SessionUser, filters: Partial<ProductFilters> = {}) {
  assertRole(session, ["EMPLOYEE", "APPROVER", "PURCHASING", "ADMIN"]);
  const { query, page, limit } = productFiltersSchema.parse(filters);
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    ...(query ? { OR: [
      { code: { contains: query, mode: "insensitive" } },
      { name: { contains: query, mode: "insensitive" } },
      { aliases: { some: { normalizedName: { contains: normalizeProductName(query) } } } },
    ] } : {}),
  };
  const db = getDb();
  const [totalCount, items] = await db.$transaction([
    db.product.count({ where }),
    db.product.findMany({ where, include, orderBy: [{ code: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  // Keep audit actor identifiers internal; the authenticated catalog needs only display fields.
  return { items: items.map(({ id, code, name, unit, isActive, aliases }) => ({ id, code, name, unit, isActive, aliases: aliases.map(({ id, name, context }) => ({ id, name, context })) })), page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) };
}

export async function createProduct(session: SessionUser, input: CreateProductInput) {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const data = createProductSchema.parse(input);
  return getDb().product.create({ data: { ...data, createdById: session.id }, select: { id: true, code: true, name: true, unit: true } });
}

export async function createProductAlias(session: SessionUser, productId: string, input: CreateProductAliasInput) {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const { name, context } = createProductAliasSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId } });
    invariant(product?.isActive, "ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน", 404);
    invariant(normalizeProductName(product.name) !== normalizeProductName(name), "ชื่อนี้ตรงกับชื่อหลักอยู่แล้ว");
    return tx.productAlias.create({ data: { productId, name, normalizedName: normalizeProductName(name), context, confirmedById: session.id }, select: { id: true, name: true, context: true } });
  });
}

export type ProductLinkInput = { productId?: string | null; productConfirmed?: boolean };
export type ProductLinkSnapshot = {
  productId: string | null;
  productCodeSnapshot: string | null;
  productNameSnapshot: string | null;
  productConfirmedById: string | null;
  productConfirmedAt: Date | null;
};

// Call inside the document write transaction. Never infer a link from spelling or alias matches.
export async function resolveConfirmedProductLinks(db: Pick<Prisma.TransactionClient, "product">, items: ProductLinkInput[], actorId: string): Promise<ProductLinkSnapshot[]> {
  const ids = [...new Set(items.flatMap((item) => item.productId ? [item.productId] : []))];
  invariant(items.every((item) => !item.productId || item.productConfirmed === true), "กรุณายืนยันการเชื่อมโยงสินค้าแต่ละรายการ");
  const products = ids.length ? await db.product.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, code: true, name: true } }) : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const confirmedAt = new Date();
  return items.map((item) => {
    if (!item.productId) return { productId: null, productCodeSnapshot: null, productNameSnapshot: null, productConfirmedById: null, productConfirmedAt: null };
    const product = byId.get(item.productId);
    invariant(product, "ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน กรุณาเลือกใหม่", 400);
    return { productId: product.id, productCodeSnapshot: product.code, productNameSnapshot: product.name, productConfirmedById: actorId, productConfirmedAt: confirmedAt };
  });
}

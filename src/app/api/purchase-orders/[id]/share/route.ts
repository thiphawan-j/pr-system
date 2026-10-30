import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { PURCHASE_ORDER_SHARE_LIFETIME_ERROR, PURCHASE_ORDER_SHARE_MAX_DAYS, PURCHASE_ORDER_SHARE_MIN_DAYS } from "@/lib/purchase-order-share";
import {
  createPurchaseOrderShare, getPurchaseOrderShare, purchaseOrderShareResponseHeaders, revokePurchaseOrderShare,
} from "@/server/purchase-orders/purchase-order-share.service";
import { AppError, toErrorResponse } from "@/server/shared/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const shareId = z.string().min(1).max(100);
const expiresInDays = z.number({ error: PURCHASE_ORDER_SHARE_LIFETIME_ERROR })
  .int(PURCHASE_ORDER_SHARE_LIFETIME_ERROR)
  .min(PURCHASE_ORDER_SHARE_MIN_DAYS, PURCHASE_ORDER_SHARE_LIFETIME_ERROR)
  .max(PURCHASE_ORDER_SHARE_MAX_DAYS, PURCHASE_ORDER_SHARE_LIFETIME_ERROR).optional();
const createSchema = z.union([
  z.object({ expiresInDays }).strict(),
  z.object({ renew: z.literal(true), expectedShareId: shareId, expiresInDays }).strict(),
]);
const revokeSchema = z.object({ expectedShareId: shareId }).strict();
type Context = { params: Promise<{ id: string }> };

function secureResponse(response: Response) {
  for (const [key, value] of Object.entries(purchaseOrderShareResponseHeaders)) response.headers.set(key, value);
  return response;
}

async function payload(request: Request) {
  return request.json().catch(() => { throw new AppError("ข้อมูลที่ส่งมาไม่ถูกต้อง", 400); });
}

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return secureResponse(Response.json(await getPurchaseOrderShare(id, session)));
  } catch (error) { return secureResponse(toErrorResponse(error)); }
}

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return secureResponse(Response.json(await createPurchaseOrderShare(id, session, createSchema.parse(await payload(request)))));
  } catch (error) { return secureResponse(toErrorResponse(error)); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    return secureResponse(Response.json(await revokePurchaseOrderShare(id, session, revokeSchema.parse(await payload(request)))));
  } catch (error) { return secureResponse(toErrorResponse(error)); }
}

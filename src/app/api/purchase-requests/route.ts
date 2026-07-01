import type { NextRequest } from "next/server";

import { requireSession } from "@/server/auth/session";
import {
  deleteSavedAttachmentFiles,
  saveAttachmentFiles,
} from "@/server/attachments/attachment.service";
import { purchaseRequestFiltersSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { parsePurchaseRequestRequest } from "@/server/purchase-requests/purchase-request.request";
import { createPurchaseRequest, listPurchaseRequests } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const filters = purchaseRequestFiltersSchema.parse({
      query: request.nextUrl.searchParams.get("query") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      department: request.nextUrl.searchParams.get("department") ?? undefined,
      from: request.nextUrl.searchParams.get("from") ?? undefined,
      to: request.nextUrl.searchParams.get("to") ?? undefined,
      sort: request.nextUrl.searchParams.get("sort") ?? undefined,
    });

    const items = await listPurchaseRequests(session, filters);

    return Response.json({ items });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let savedAttachments: Awaited<ReturnType<typeof saveAttachmentFiles>> = [];

  try {
    const session = await requireSession();
    const { payload, files } = await parsePurchaseRequestRequest(request);

    savedAttachments = await saveAttachmentFiles(files);

    const id = await createPurchaseRequest(session, {
      ...payload,
      attachments: savedAttachments,
    });

    return Response.json({ id });
  } catch (error) {
    if (savedAttachments.length) {
      await deleteSavedAttachmentFiles(savedAttachments);
    }

    return toErrorResponse(error);
  }
}

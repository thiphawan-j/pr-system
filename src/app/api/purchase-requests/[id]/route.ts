import { requireSession } from "@/server/auth/session";
import {
  deleteSavedAttachmentFiles,
  saveAttachmentFiles,
} from "@/server/attachments/attachment.service";
import { parsePurchaseRequestRequest } from "@/server/purchase-requests/purchase-request.request";
import { getPurchaseRequestById, updatePurchaseRequest } from "@/server/purchase-requests/purchase-request.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const item = await getPurchaseRequestById(id, session);

    return Response.json(item);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let savedAttachments: Awaited<ReturnType<typeof saveAttachmentFiles>> = [];

  try {
    const session = await requireSession();
    const { id } = await context.params;
    const { payload, files } = await parsePurchaseRequestRequest(request);

    savedAttachments = await saveAttachmentFiles(files);

    const updatedId = await updatePurchaseRequest(id, session, {
      ...payload,
      attachments: savedAttachments,
    });

    return Response.json({ id: updatedId });
  } catch (error) {
    if (savedAttachments.length) {
      await deleteSavedAttachmentFiles(savedAttachments);
    }

    return toErrorResponse(error);
  }
}

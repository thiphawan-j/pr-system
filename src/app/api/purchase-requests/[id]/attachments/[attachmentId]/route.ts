import { requireSession } from "@/server/auth/session";
import {
  deleteAttachmentFromPurchaseRequest,
  getAttachmentForDownload,
} from "@/server/attachments/attachment.service";
import { toErrorResponse } from "@/server/shared/errors";

function getContentDisposition(
  fileName: string,
  dispositionType: "attachment" | "inline",
) {
  const encodedFileName = encodeURIComponent(fileName);

  return `${dispositionType}; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const session = await requireSession();
    const { id, attachmentId } = await context.params;
    const dispositionType =
      new URL(request.url).searchParams.get("disposition") === "inline"
        ? "inline"
        : "attachment";
    const { attachment, bytes } = await getAttachmentForDownload(
      id,
      attachmentId,
      session,
    );

    return new Response(bytes, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.size),
        "Content-Disposition": getContentDisposition(
          attachment.originalName,
          dispositionType,
        ),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const session = await requireSession();
    const { id, attachmentId } = await context.params;

    await deleteAttachmentFromPurchaseRequest(id, attachmentId, session);

    return Response.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

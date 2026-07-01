import { requireSession } from "@/server/auth/session";
import { getAttachmentForDownload } from "@/server/attachments/attachment.service";
import { toErrorResponse } from "@/server/shared/errors";

function getContentDisposition(fileName: string) {
  const encodedFileName = encodeURIComponent(fileName);

  return `attachment; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const session = await requireSession();
    const { id, attachmentId } = await context.params;
    const { attachment, bytes } = await getAttachmentForDownload(
      id,
      attachmentId,
      session,
    );

    return new Response(bytes, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.size),
        "Content-Disposition": getContentDisposition(attachment.originalName),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

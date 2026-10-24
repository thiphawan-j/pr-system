import { requireSession } from "@/server/auth/session";
import { assertRole } from "@/server/auth/authorization";
import { updateCompanyProfileSchema } from "@/server/company/company.schemas";
import { getCompanyProfile, saveCompanyProfile } from "@/server/company/company.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function GET() {
  try {
    const session = await requireSession();
    const company = await getCompanyProfile(session);
    return Response.json(company);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSession();
    assertRole(session, ["ADMIN"]);
    const input = updateCompanyProfileSchema.parse(await request.json());
    const company = await saveCompanyProfile(session, input);
    return Response.json(company);
  } catch (error) {
    return toErrorResponse(error);
  }
}

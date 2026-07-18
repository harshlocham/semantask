import { NextResponse } from "next/server";
import {
    ORGANIZATION_ID_HEADER,
    resolveOrganizationIdForUser,
} from "@semantask/services/organization.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import type { AuthUser } from "@/lib/utils/auth/getAuthUser";

export { ORGANIZATION_ID_HEADER };

export type OrganizationContext =
    | { organizationId: string | null; response: null }
    | { organizationId: null; response: NextResponse };

/**
 * Resolve optional org context from `X-Organization-Id`.
 * Missing header → personal workspace (null).
 */
export async function resolveOrganizationContext(
    req: Request,
    user: AuthUser
): Promise<OrganizationContext> {
    const header = req.headers.get(ORGANIZATION_ID_HEADER);

    try {
        const organizationId = await resolveOrganizationIdForUser(user.id, header);
        return { organizationId, response: null };
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return {
                organizationId: null,
                response: NextResponse.json(
                    {
                        success: false,
                        error: error.message,
                        code: error.code === "NOT_FOUND" ? "ORG_NOT_FOUND" : "ORG_FORBIDDEN",
                    },
                    { status: error.code === "NOT_FOUND" ? 404 : 403 }
                ),
            };
        }

        return {
            organizationId: null,
            response: NextResponse.json(
                { success: false, error: "Invalid organization context", code: "ORG_INVALID" },
                { status: 400 }
            ),
        };
    }
}

"use client";

import { useEffect, useMemo } from "react";
import { useActiveOrganizationId, writeActiveOrganizationId } from "@/hooks/useActiveOrganizationId";
import { useOrganizationsList } from "@/lib/queries/use-organizations";

/** Active org id + resolved name for product scope labels. */
export function useActiveOrganization() {
    const storedId = useActiveOrganizationId();
    const orgsQuery = useOrganizationsList();
    const orgs = orgsQuery.data;

    const organizationId = useMemo(() => {
        if (!orgs) return null;
        if (storedId && orgs.some((org) => org.id === storedId)) return storedId;
        return null;
    }, [storedId, orgs]);

    useEffect(() => {
        if (!orgs || !storedId) return;
        if (!orgs.some((org) => org.id === storedId)) {
            writeActiveOrganizationId(null);
        }
    }, [orgs, storedId]);

    const organization = useMemo(() => {
        if (!organizationId || !orgs) return null;
        const match = orgs.find((org) => org.id === organizationId);
        if (!match) return null;
        return {
            id: organizationId,
            name: match.name,
            role: match.role,
        };
    }, [organizationId, orgs]);

    return {
        organizationId,
        organization,
        isLoading: orgsQuery.isLoading,
        organizationScopeReady: orgs !== undefined || orgsQuery.isError,
    };
}

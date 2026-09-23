"use client";

import Link from "next/link";
import { Select } from "@/components/ui/select";
import { useActiveOrganization } from "@/hooks/useActiveOrganization";
import { writeActiveOrganizationId } from "@/hooks/useActiveOrganizationId";
import { useOrganizationsList } from "@/lib/queries/use-organizations";

export function OrganizationSwitcher({
    compact = false,
}: {
    compact?: boolean;
}) {
    const { organizationId } = useActiveOrganization();
    const orgsQuery = useOrganizationsList();
    const orgs = orgsQuery.data ?? [];

    return (
        <div className="flex flex-wrap items-center gap-2" data-testid="organization-switcher">
            <label htmlFor="organization-switcher" className="sr-only">
                Active organization
            </label>
            <Select
                id="organization-switcher"
                data-testid="organization-switcher-select"
                className="h-9 w-full max-w-full sm:w-[220px]"
                value={organizationId ?? ""}
                onChange={(event) => {
                    writeActiveOrganizationId(event.target.value || null);
                }}
            >
                <option value="">Personal workspace</option>
                {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                        {org.name}
                    </option>
                ))}
            </Select>
            {compact ? null : (
                <Link
                    href="/organizations"
                    className="text-xs text-muted-foreground underline underline-offset-2"
                >
                    Manage
                </Link>
            )}
        </div>
    );
}

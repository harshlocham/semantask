"use client";

import { useId } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { useActiveOrganization } from "@/hooks/useActiveOrganization";
import { writeActiveOrganizationId } from "@/hooks/useActiveOrganizationId";
import { useOrganizationsList } from "@/lib/queries/use-organizations";
import { cn } from "@/lib/utils/utils";

export function OrganizationSwitcher({
    compact = false,
    variant = "header",
}: {
    compact?: boolean;
    variant?: "header" | "sidebar";
}) {
    const selectId = useId();
    const { organizationId } = useActiveOrganization();
    const orgsQuery = useOrganizationsList();
    const orgs = orgsQuery.data ?? [];
    const sidebar = variant === "sidebar";

    return (
        <div
            className={cn("flex items-center gap-2", sidebar ? "gap-1" : "flex-wrap")}
            data-testid="organization-switcher"
        >
            <label htmlFor={selectId} className="sr-only">
                Active organization
            </label>
            <Select
                id={selectId}
                data-testid="organization-switcher-select"
                className={cn(
                    "h-8 text-[13px]",
                    sidebar ? "min-w-0 flex-1 bg-background font-medium" : "w-full max-w-full sm:w-[180px]"
                )}
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
            {compact ? null : sidebar ? (
                <Link
                    href="/organizations"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Manage organizations"
                    title="Manage organizations"
                >
                    <Settings2 aria-hidden="true" size={15} />
                </Link>
            ) : (
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

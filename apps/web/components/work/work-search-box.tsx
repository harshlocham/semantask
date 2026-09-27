"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useActiveOrganization } from "@/lib/hooks/useActiveOrganization";
import { searchOrganizationWork, type WorkSearchHit } from "@/lib/utils/api";

export function WorkSearchBox() {
    const { organizationId } = useActiveOrganization();
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<WorkSearchHit[]>([]);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!organizationId || query.trim().length < 2) {
            setHits([]);
            return;
        }
        let current = true;
        const handle = window.setTimeout(() => {
            void searchOrganizationWork(organizationId, query)
                .then((result) => {
                    if (current) setHits(result);
                })
                .catch(() => {
                    if (current) setHits([]);
                });
        }, 250);
        return () => {
            current = false;
            window.clearTimeout(handle);
        };
    }, [organizationId, query]);

    if (!organizationId) return null;

    return (
        <div className="relative min-w-[180px] flex-1" data-testid="work-search">
            <input
                data-testid="work-search-input"
                className="h-8 w-full max-w-md rounded-lg border border-input bg-background px-3 text-[13px]"
                placeholder="Search work, people, conversations"
                value={query}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
            />
            {open && hits.length > 0 ? (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-background p-1 text-sm shadow">
                    {hits.map((hit) => (
                        <li key={`${hit.kind}-${hit.id}`}>
                            <Link
                                href={hit.href}
                                className="block rounded px-2 py-1 hover:bg-muted"
                                onClick={() => setOpen(false)}
                            >
                                <span className="text-[10px] uppercase text-muted-foreground">{hit.kind}</span>
                                <span className="ml-2">{hit.title}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { APP_HOME } from "@/lib/routes";

export type DeepLinkResource = "conversation" | "task";

type DeepLinkAccessViewProps = {
    resource: DeepLinkResource;
    loading?: boolean;
    errorStatus?: number | null;
    errorMessage?: string | null;
};

const COPY: Record<
    DeepLinkResource,
    { loading: string; forbiddenTitle: string; forbiddenFallback: string; notFoundTitle: string; notFoundFallback: string; errorTitle: string; errorFallback: string }
> = {
    conversation: {
        loading: "Loading conversation…",
        forbiddenTitle: "Unable to view conversation",
        forbiddenFallback: "You do not have access to this conversation.",
        notFoundTitle: "Conversation not found",
        notFoundFallback: "This conversation does not exist or is no longer available.",
        errorTitle: "Unable to load conversation",
        errorFallback: "Something went wrong while loading this conversation.",
    },
    task: {
        loading: "Opening task…",
        forbiddenTitle: "Unable to view task",
        forbiddenFallback: "You do not have access to this task.",
        notFoundTitle: "Task not found",
        notFoundFallback: "This task does not exist or is no longer available.",
        errorTitle: "Unable to load task",
        errorFallback: "Something went wrong while loading this task.",
    },
};

export function DeepLinkAccessView({
    resource,
    loading = false,
    errorStatus = null,
    errorMessage = null,
}: DeepLinkAccessViewProps) {
    const copy = COPY[resource];

    if (loading) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid={`${resource}-deep-link-loading`}>
                <p className="text-sm text-muted-foreground">{copy.loading}</p>
            </div>
        );
    }

    if (errorStatus === 401 || errorStatus === 403) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid={`${resource}-deep-link-forbidden`}>
                <h1 className="text-2xl font-bold">{copy.forbiddenTitle}</h1>
                <p className="text-sm text-muted-foreground">{errorMessage || copy.forbiddenFallback}</p>
                <Button asChild variant="outline">
                    <Link href={APP_HOME}>Back to chat</Link>
                </Button>
            </div>
        );
    }

    if (errorStatus === 404) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid={`${resource}-deep-link-not-found`}>
                <h1 className="text-2xl font-bold">{copy.notFoundTitle}</h1>
                <p className="text-sm text-muted-foreground">{errorMessage || copy.notFoundFallback}</p>
                <Button asChild variant="outline">
                    <Link href={APP_HOME}>Back to chat</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid={`${resource}-deep-link-error`}>
            <h1 className="text-2xl font-bold">{copy.errorTitle}</h1>
            <p className="text-sm text-muted-foreground">{errorMessage || copy.errorFallback}</p>
            <Button asChild variant="outline">
                <Link href={APP_HOME}>Back to chat</Link>
            </Button>
        </div>
    );
}

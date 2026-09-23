import { cn } from "@/lib/utils/utils";

function priorityTone(priority: string) {
    if (priority === "urgent" || priority === "high") return "bg-destructive/10 text-destructive";
    if (priority === "medium") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    return "bg-muted text-muted-foreground";
}

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize",
                priorityTone(priority),
                className
            )}
        >
            {priority}
        </span>
    );
}

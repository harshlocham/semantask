import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { WorkSearchBox } from "@/components/work/work-search-box";

export default function InboxLayout({ children }: { children: React.ReactNode }) {
    return (
        <WorkspaceLayout>
            <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
                <WorkSearchBox />
                {children}
            </div>
        </WorkspaceLayout>
    );
}

import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { WorkSearchBox } from "@/components/work/work-search-box";

export default function InboxLayout({ children }: { children: React.ReactNode }) {
    return (
        <WorkspaceLayout>
            <div className="w-full max-w-6xl space-y-3 px-4 py-4 lg:px-5">
                <div className="flex md:hidden">
                    <WorkSearchBox />
                </div>
                {children}
            </div>
        </WorkspaceLayout>
    );
}

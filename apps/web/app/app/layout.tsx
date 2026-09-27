import { WorkspaceLayout } from "@/components/shell/workspace-layout";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
    return <WorkspaceLayout>{children}</WorkspaceLayout>;
}

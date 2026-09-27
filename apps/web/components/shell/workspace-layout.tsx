import {
    isCoordinationBoardEnabled,
    isOrgDashboardEnabled,
} from "@semantask/services/organization-policy.service";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

export function WorkspaceLayout({ children }: { children: React.ReactNode }) {
    return (
        <WorkspaceShell
            boardEnabled={isCoordinationBoardEnabled()}
            dashboardEnabled={isOrgDashboardEnabled()}
        >
            {children}
        </WorkspaceShell>
    );
}

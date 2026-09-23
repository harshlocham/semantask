import type {
    BoardStatus,
    ClientConversation,
    ClientUser,
    TaskPriority,
    TaskRecord,
    UIMessage,
    WorkSuggestionRecord,
    WorkSuggestionStatus,
    WorkSummary,
} from "@semantask/types";
import {
    AuthSessionPendingError,
    parseAuthPayload,
    redirectToLogin,
    refreshSession,
} from "@/lib/utils/auth/client-session";
import { ensureAuthReady, authReady, isAuthenticated } from "@/lib/auth/authBootstrap";

export class ApiHttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "ApiHttpError";
        this.status = status;
    }
}

type ApiErrorPayload = {
    error?: string;
    code?: string;
    requiresReauth?: boolean;
};

export type AdminAuthEventType = "LOGIN" | "REFRESH" | "REVOKE" | "STEP_UP";

export type AdminAuthEvent = {
    id: string;
    eventType: AdminAuthEventType;
    eventName: string;
    outcome: "success" | "failure";
    userId: string | null;
    timestamp: string;
    ipAddress: string;
    userAgent: string;
    reason?: string;
};

export type AdminAuthEventsResponse = {
    events: AdminAuthEvent[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
};

export type TaskApprovalRecord = {
    _id: string;
    taskId: string;
    conversationId: string;
    actorType: "user" | "agent" | "system";
    actorId: string | null;
    actionType: string;
    toolName: string | null;
    messageId: string | null;
    parameters: Record<string, unknown>;
    executionState: string | null;
    summary: string | null;
    error: string | null;
    patch: {
        before: unknown | null;
        after: unknown | null;
    };
    reason: string;
    idempotencyKey: string;
    createdAt: string;
};

export type TaskApprovalsResponse = {
    approvals: TaskApprovalRecord[];
};

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function authenticatedFetch(
    url: string,
    init?: RequestInit,
    hasRetried = false
): Promise<Response> {
    // Ensure auth bootstrap completes before attempting protected requests
    // Skip waiting for the refresh endpoint itself to avoid deadlocks
    if (url !== "/api/auth/refresh") {
        try {
            await ensureAuthReady();
        } catch (err) {
            console.warn("authenticatedFetch: ensureAuthReady failed", err);
        }
    }

    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    if (
        typeof window !== "undefined"
        && window.localStorage
        && !headers.has("X-Organization-Id")
    ) {
        const activeOrgId = window.localStorage.getItem("semantask.activeOrganizationId");
        if (activeOrgId) {
            headers.set("X-Organization-Id", activeOrgId);
        }
    }

    const response = await fetch(url, {
        ...init,
        credentials: "include",
        headers,
    });

    if (response.ok) {
        return response;
    }

    if (response.status === 401 && !hasRetried && url !== "/api/auth/refresh") {
        // Bootstrap already attempted refresh recovery; avoid a 401 -> refresh storm.
        if (authReady && !isAuthenticated) {
            return response;
        }

        const refreshed = await refreshSession();

        if (refreshed.ok) {
            return authenticatedFetch(url, init, true);
        }

        if (refreshed.ok === false && refreshed.reason === "rate_limited") {
            throw new AuthSessionPendingError(
                "unauthenticated",
                "Too many refresh attempts. Try again later."
            );
        }

        if (refreshed.ok === false && refreshed.reason === "transient") {
            await wait(250);
            const retriedRefresh = await refreshSession();
            if (retriedRefresh.ok) {
                return authenticatedFetch(url, init, true);
            }

            if (retriedRefresh.ok === false && retriedRefresh.reason === "rate_limited") {
                throw new AuthSessionPendingError(
                    "unauthenticated",
                    "Too many refresh attempts. Try again later."
                );
            }

            if (retriedRefresh.ok === false && retriedRefresh.reason === "unauthorized") {
                redirectToLogin();
            }
        }

        if (refreshed.ok === false && refreshed.reason === "unauthorized") {
            redirectToLogin();
        }
    }

    return response;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await authenticatedFetch(url, init);

    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as ApiErrorPayload | null;

    if (!response.ok) {
        throw new Error(payload?.error || rawText || `Request failed with status ${response.status}`);
    }

    if (response.status === 204 || !rawText) {
        return undefined as T;
    }

    return JSON.parse(rawText) as T;
}

export async function getMe(): Promise<ClientUser> {
    return request<ClientUser>("/api/me");
}

export async function getUsers(): Promise<ClientUser[]> {
    return request<ClientUser[]>("/api/users");
}

export async function completeOnboarding(): Promise<{ conversationId: string }> {
    return request<{ conversationId: string }>("/api/onboarding/complete", {
        method: "POST",
    });
}

export async function getConversations(): Promise<ClientConversation[]> {
    return request<ClientConversation[]>("/api/conversations");
}

function toClientConversation(raw: Record<string, unknown>, fallbackId: string): ClientConversation {
    const isGroup = Boolean(raw.isGroup);
    return {
        ...(raw as unknown as ClientConversation),
        _id: String(raw._id ?? fallbackId),
        isGroup,
        type: isGroup || raw.type === "group" ? "group" : "direct",
        participants: Array.isArray(raw.participants)
            ? (raw.participants as ClientConversation["participants"])
            : [],
    };
}

export async function getConversation(id: string): Promise<ClientConversation> {
    const response = await authenticatedFetch(`/api/conversations/${encodeURIComponent(id)}`);
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as (ApiErrorPayload & Record<string, unknown>) | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    if (!payload || typeof payload !== "object") {
        throw new ApiHttpError(500, "Invalid conversation response");
    }

    return toClientConversation(payload, id);
}

export async function getTask(id: string): Promise<TaskRecord> {
    const response = await authenticatedFetch(`/api/tasks/${encodeURIComponent(id)}`);
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as (ApiErrorPayload & TaskRecord) | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    if (!payload || typeof payload !== "object" || !payload._id) {
        throw new ApiHttpError(500, "Invalid task response");
    }

    return payload as TaskRecord;
}

export async function createConversation(payload: {
    participants: string[];
    isGroup: boolean;
    admin?: string;
    groupName?: string;
    image?: string;
}): Promise<string> {
    const data = await request<{ _id?: string; id?: string } | string>("/api/conversations", {
        method: "POST",
        body: JSON.stringify(payload),
    });

    if (typeof data === "string") return data;
    return String(data._id || data.id || "");
}

export async function toggleBan(id: string, status: "active" | "banned") {
    return request<{ success: boolean }>("/api/admin/toggleban", {
        method: "PATCH",
        body: JSON.stringify({ id, status }),
    });
}

export async function changePermission(id: string, role: "user" | "moderator" | "admin") {
    return request<{ userrole: string }>("/api/admin/changeRoal", {
        method: "PATCH",
        body: JSON.stringify({ id, role }),
    });
}

export async function deleteMessage(messageId: string) {
    return request<{ success: boolean }>(`/api/messages/${messageId}/delete`, {
        method: "DELETE",
    });
}

export async function reactToMessage(message: UIMessage, emoji: string) {
    const id = typeof message._id === "string" ? message._id : String(message._id);
    return request<{ success: boolean }>(`/api/messages/${id}/react`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
    });
}

export async function getAdminAuthEvents(params?: {
    page?: number;
    limit?: number;
    eventType?: AdminAuthEventType;
    userId?: string;
    date?: string;
}): Promise<AdminAuthEventsResponse> {
    const searchParams = new URLSearchParams();

    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.eventType) searchParams.set("eventType", params.eventType);
    if (params?.userId) searchParams.set("userId", params.userId);
    if (params?.date) searchParams.set("date", params.date);

    const query = searchParams.toString();
    const data = await request<{ success: boolean; data: AdminAuthEventsResponse }>(
        `/api/admin/auth-events${query ? `?${query}` : ""}`
    );

    return data.data;
}

export type AdminToolGrant = {
    id: string;
    userId: string;
    conversationId: string | null;
    toolName: string;
    grantedBy: string;
    revokedAt: string | null;
    createdAt: string;
};

export type AdminToolGrantsResponse = {
    grants: AdminToolGrant[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
};

export async function getAdminToolGrants(params?: {
    page?: number;
    limit?: number;
    userId?: string;
    toolName?: string;
    includeRevoked?: boolean;
}): Promise<AdminToolGrantsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.userId) searchParams.set("userId", params.userId);
    if (params?.toolName) searchParams.set("toolName", params.toolName);
    if (params?.includeRevoked) searchParams.set("includeRevoked", "1");

    const query = searchParams.toString();
    const data = await request<{ success: boolean; data: AdminToolGrantsResponse }>(
        `/api/admin/tool-grants${query ? `?${query}` : ""}`
    );
    return data.data;
}

export async function createAdminToolGrant(input: {
    userId: string;
    toolName: string;
    conversationId?: string | null;
}): Promise<AdminToolGrant> {
    const data = await request<{ success: boolean; data: AdminToolGrant }>("/api/admin/tool-grants", {
        method: "POST",
        body: JSON.stringify(input),
    });
    return data.data;
}

export async function seedAdminToolGrants(): Promise<{ usersConsidered: number; grantsCreated: number }> {
    const data = await request<{ success: boolean; data: { usersConsidered: number; grantsCreated: number } }>(
        "/api/admin/tool-grants",
        {
            method: "POST",
            body: JSON.stringify({ action: "seed" }),
        }
    );
    return data.data;
}

export async function revokeAdminToolGrant(grantId: string): Promise<void> {
    await request<{ success: boolean }>(`/api/admin/tool-grants/${grantId}`, {
        method: "DELETE",
    });
}

export async function getTaskApprovals(options?: {
    conversationId?: string;
    organizationId?: string;
}): Promise<TaskApprovalsResponse> {
    const params = new URLSearchParams();
    if (options?.conversationId) {
        params.set("conversationId", options.conversationId);
    }
    if (options?.organizationId) {
        params.set("organizationId", options.organizationId);
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    return request<TaskApprovalsResponse>(`/api/task-approvals${query}`);
}

export async function requestTaskExecutionApi(
    taskId: string,
    input?: { reason?: string }
): Promise<{
    taskAction: TaskApprovalRecord;
    enqueued: boolean;
    alreadyPending: boolean;
}> {
    const response = await authenticatedFetch(
        `/api/tasks/${encodeURIComponent(taskId)}/request-execution`,
        {
            method: "POST",
            body: JSON.stringify(input ?? {}),
        }
    );
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as ApiErrorPayload & {
        success?: boolean;
        data?: {
            taskAction: TaskApprovalRecord;
            enqueued: boolean;
            alreadyPending: boolean;
        };
    } | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    if (!payload?.data) {
        throw new ApiHttpError(500, "Invalid request-execution response");
    }

    return payload.data;
}

export type WorkSuggestionListResult = {
    items: WorkSuggestionRecord[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
};

export async function listWorkSuggestions(params: {
    conversationId?: string;
    organizationId?: string;
    status?: WorkSuggestionStatus;
    page?: number;
    limit?: number;
}): Promise<WorkSuggestionListResult> {
    const searchParams = new URLSearchParams();
    if (params.conversationId) searchParams.set("conversationId", params.conversationId);
    if (params.organizationId) searchParams.set("organizationId", params.organizationId);
    if (params.status) searchParams.set("status", params.status);
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));

    const query = searchParams.toString();
    const data = await request<{ success: boolean; data: WorkSuggestionListResult }>(
        `/api/work-suggestions${query ? `?${query}` : ""}`
    );
    return data.data;
}

export type WorkBoardListResult = {
    items: TaskRecord[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
};

export async function listWorkBoard(params: {
    conversationId?: string;
    organizationId?: string;
    boardStatus?: BoardStatus;
    priority?: string;
    due?: "overdue" | "none";
    page?: number;
    limit?: number;
}): Promise<WorkBoardListResult> {
    const searchParams = new URLSearchParams();
    if (params.conversationId) searchParams.set("conversationId", params.conversationId);
    if (params.organizationId) searchParams.set("organizationId", params.organizationId);
    if (params.boardStatus) searchParams.set("boardStatus", params.boardStatus);
    if (params.priority) searchParams.set("priority", params.priority);
    if (params.due) searchParams.set("due", params.due);
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));

    const query = searchParams.toString();
    const data = await request<{ success: boolean; data: WorkBoardListResult }>(
        `/api/work-board${query ? `?${query}` : ""}`
    );
    return data.data;
}

export async function getCoordinationBoardEnabled(): Promise<boolean> {
    const response = await authenticatedFetch("/api/work-board/enabled");
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as ApiErrorPayload & {
        success?: boolean;
        data?: { enabled?: boolean };
    } | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    return Boolean(payload?.data?.enabled);
}

export async function getOrgDashboardEnabled(): Promise<boolean> {
    const response = await authenticatedFetch("/api/work-summary/enabled");
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as ApiErrorPayload & {
        success?: boolean;
        data?: { enabled?: boolean };
    } | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    return Boolean(payload?.data?.enabled);
}

export async function getOrganizationWorkSummary(organizationId: string): Promise<WorkSummary> {
    const response = await authenticatedFetch(
        `/api/organizations/${encodeURIComponent(organizationId)}/work-summary`
    );
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as ApiErrorPayload & {
        success?: boolean;
        data?: WorkSummary;
    } | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    if (!payload?.data) {
        throw new ApiHttpError(500, "Invalid work summary response");
    }

    return payload.data;
}

export async function patchTaskApi(
    taskId: string,
    patch: {
        title?: string;
        description?: string;
        status?: TaskRecord["status"];
        boardStatus?: BoardStatus;
        priority?: TaskPriority;
        assignees?: string[];
        dueAt?: string | null;
        tags?: string[];
    }
): Promise<TaskRecord> {
    return request<TaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
    });
}

export async function getWorkInboxEnabled(): Promise<boolean> {
    const response = await authenticatedFetch("/api/work-inbox/enabled");
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as ApiErrorPayload & {
        success?: boolean;
        data?: { enabled?: boolean };
    } | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    return Boolean(payload?.data?.enabled);
}

export async function getWorkSuggestion(id: string): Promise<WorkSuggestionRecord> {
    const response = await authenticatedFetch(`/api/work-suggestions/${encodeURIComponent(id)}`);
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as ApiErrorPayload & {
        success?: boolean;
        data?: WorkSuggestionRecord;
    } | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    if (!payload?.data) {
        throw new ApiHttpError(500, "Invalid work suggestion response");
    }

    return payload.data;
}

async function mutateWorkSuggestion<T>(
    id: string,
    action: "accept" | "dismiss" | "assign",
    body?: Record<string, unknown>
): Promise<T> {
    const response = await authenticatedFetch(
        `/api/work-suggestions/${encodeURIComponent(id)}/${action}`,
        {
            method: "POST",
            body: JSON.stringify(body ?? {}),
        }
    );
    const rawText = await response.text();
    const payload = parseAuthPayload(rawText) as ApiErrorPayload & {
        success?: boolean;
        data?: T;
    } | null;

    if (!response.ok) {
        throw new ApiHttpError(
            response.status,
            payload?.error || rawText || `Request failed with status ${response.status}`
        );
    }

    if (!payload?.data) {
        throw new ApiHttpError(500, `Invalid work suggestion ${action} response`);
    }

    return payload.data;
}

export type AcceptWorkSuggestionResponse = {
    suggestion: WorkSuggestionRecord;
    task: TaskRecord;
};

export async function acceptWorkSuggestionApi(
    id: string,
    input?: {
        assignees?: string[];
        dueAt?: string | null;
        priority?: TaskPriority;
    }
): Promise<AcceptWorkSuggestionResponse> {
    return mutateWorkSuggestion<AcceptWorkSuggestionResponse>(id, "accept", input);
}

export async function dismissWorkSuggestionApi(
    id: string,
    reason: string
): Promise<WorkSuggestionRecord> {
    return mutateWorkSuggestion<WorkSuggestionRecord>(id, "dismiss", { reason });
}

export type AssignWorkSuggestionResponse = {
    suggestion: WorkSuggestionRecord;
    task: TaskRecord;
};

export async function assignWorkSuggestionApi(
    id: string,
    input: {
        assignees?: string[];
        dueAt?: string | null;
        priority?: TaskPriority;
    }
): Promise<AssignWorkSuggestionResponse> {
    return mutateWorkSuggestion<AssignWorkSuggestionResponse>(id, "assign", input);
}

export async function decideTaskApproval(input: {
    taskActionId: string;
    decision: "approve" | "reject";
    reason?: string;
    reviewerComment?: string;
    parameters?: Record<string, unknown>;
}): Promise<{ approval: TaskApprovalRecord | null }> {
    return request<{ approval: TaskApprovalRecord | null }>("/api/task-approvals", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export type ClientOrganization = {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    role: string;
};

export async function listOrganizations(): Promise<ClientOrganization[]> {
    const data = await request<{ success: boolean; data: ClientOrganization[] }>("/api/organizations");
    return data.data;
}

export async function createOrganization(input: {
    name: string;
    slug?: string;
}): Promise<ClientOrganization> {
    const data = await request<{ success: boolean; data: ClientOrganization }>("/api/organizations", {
        method: "POST",
        body: JSON.stringify(input),
    });
    return data.data;
}

export async function getOrganizationMembers(
    organizationId: string
): Promise<
    Array<{
        id: string;
        userId: string;
        role: string;
        createdAt: string;
        user: { id: string; username: string; email?: string; profilePicture?: string | null };
    }>
> {
    const data = await request<{
        success: boolean;
        data: Array<{
            id: string;
            userId: string;
            role: string;
            createdAt: string;
            user: { id: string; username: string; email?: string; profilePicture?: string | null };
        }>;
    }>(`/api/organizations/${organizationId}/members`);
    return data.data;
}

export async function addOrganizationMember(
    organizationId: string,
    input: { userId: string; role?: string }
): Promise<void> {
    await request<{ success: boolean }>(`/api/organizations/${organizationId}/members`, {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export async function getOrganizationPolicy(organizationId: string): Promise<Record<string, unknown>> {
    const data = await request<{ success: boolean; data: Record<string, unknown> }>(
        `/api/organizations/${organizationId}/policy`
    );
    return data.data;
}

export async function updateOrganizationPolicy(
    organizationId: string,
    patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
    const data = await request<{ success: boolean; data: Record<string, unknown> }>(
        `/api/organizations/${organizationId}/policy`,
        {
            method: "PUT",
            body: JSON.stringify(patch),
        }
    );
    return data.data;
}

export async function getOrganizationQuota(organizationId: string): Promise<Record<string, unknown> | null> {
    const data = await request<{ success: boolean; data: Record<string, unknown> | null }>(
        `/api/organizations/${organizationId}/quota`
    );
    return data.data;
}

export async function updateOrganizationQuota(
    organizationId: string,
    patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
    const data = await request<{ success: boolean; data: Record<string, unknown> }>(
        `/api/organizations/${organizationId}/quota`,
        {
            method: "PUT",
            body: JSON.stringify(patch),
        }
    );
    return data.data;
}

export type OrganizationInvitationClient = {
    id: string;
    organizationId: string;
    organizationName: string;
    email: string;
    role: string;
    status: string;
    expiresAt: string;
    createdAt: string;
    acceptedAt: string | null;
    emailSent?: boolean;
    inviteUrl?: string;
};

export async function listOrganizationInvitations(
    organizationId: string
): Promise<OrganizationInvitationClient[]> {
    const data = await request<{ success: boolean; data: OrganizationInvitationClient[] }>(
        `/api/organizations/${organizationId}/invitations`
    );
    return data.data;
}

export async function createOrganizationInvitation(
    organizationId: string,
    input: { email: string; role?: string }
): Promise<OrganizationInvitationClient> {
    const data = await request<{ success: boolean; data: OrganizationInvitationClient }>(
        `/api/organizations/${organizationId}/invitations`,
        {
            method: "POST",
            body: JSON.stringify(input),
        }
    );
    return data.data;
}

export async function revokeOrganizationInvitation(
    organizationId: string,
    invitationId: string
): Promise<void> {
    await request<{ success: boolean }>(`/api/organizations/${organizationId}/invitations`, {
        method: "DELETE",
        body: JSON.stringify({ invitationId }),
    });
}

export async function resendOrganizationInvitation(
    organizationId: string,
    invitationId: string
): Promise<OrganizationInvitationClient> {
    const data = await request<{ success: boolean; data: OrganizationInvitationClient }>(
        `/api/organizations/${organizationId}/invitations`,
        {
            method: "PATCH",
            body: JSON.stringify({ invitationId }),
        }
    );
    return data.data;
}

export async function removeOrganizationMember(
    organizationId: string,
    userId: string
): Promise<void> {
    await request<{ success: boolean }>(`/api/organizations/${organizationId}/members`, {
        method: "DELETE",
        body: JSON.stringify({ userId }),
    });
}

export async function updateOrganizationMemberRole(
    organizationId: string,
    input: { userId: string; role: string }
): Promise<void> {
    await request<{ success: boolean }>(`/api/organizations/${organizationId}/members`, {
        method: "PATCH",
        body: JSON.stringify(input),
    });
}

export async function leaveOrganization(organizationId: string): Promise<void> {
    await request<{ success: boolean }>(`/api/organizations/${organizationId}/members`, {
        method: "PATCH",
        body: JSON.stringify({ leave: true }),
    });
}

export async function getOrganizationInvitationApi(
    token: string
): Promise<OrganizationInvitationClient> {
    const data = await request<{ success: boolean; data: OrganizationInvitationClient }>(
        `/api/invitations/${encodeURIComponent(token)}`
    );
    return data.data;
}

export async function acceptOrganizationInvitationApi(token: string): Promise<{
    invitation: OrganizationInvitationClient;
    organizationId: string;
}> {
    const data = await request<{
        success: boolean;
        data: { invitation: OrganizationInvitationClient; organizationId: string };
    }>(`/api/invitations/${encodeURIComponent(token)}`, {
        method: "POST",
    });
    return data.data;
}

export type WorkSearchHit = {
    kind: "task" | "conversation" | "person" | "suggestion" | "execution";
    id: string;
    title: string;
    href: string;
    subtitle?: string | null;
};

export async function searchOrganizationWork(
    organizationId: string,
    query: string
): Promise<WorkSearchHit[]> {
    const data = await request<{ success: boolean; data: WorkSearchHit[] }>(
        `/api/organizations/${organizationId}/search?q=${encodeURIComponent(query)}`
    );
    return data.data;
}

export async function getOrganizationUsage(organizationId: string): Promise<{
    tokensThisMonth: number;
    periodStart: string;
}> {
    const data = await request<{
        success: boolean;
        data: { tokensThisMonth: number; periodStart: string };
    }>(`/api/organizations/${organizationId}/usage`);
    return data.data;
}

export async function listOrganizationToolGrants(organizationId: string): Promise<{
    grants: Array<{
        id: string;
        userId: string;
        toolName: string;
        grantedBy: string;
        revokedAt: string | null;
        createdAt: string;
    }>;
}> {
    const data = await request<{
        success: boolean;
        data: {
            grants: Array<{
                id: string;
                userId: string;
                toolName: string;
                grantedBy: string;
                revokedAt: string | null;
                createdAt: string;
            }>;
        };
    }>(`/api/organizations/${organizationId}/tool-grants`);
    return data.data;
}

export async function getAdminExecutionAudit(params?: {
    page?: number;
    limit?: number;
    taskId?: string;
    tool?: string;
}): Promise<{
    events: Array<{
        id: string;
        taskId: string;
        taskTitle?: string | null;
        actorId: string | null;
        actorRef?: { id: string; username: string } | null;
        runId: string | null;
        toolName: string;
        action: string;
        paramsHash: string;
        createdAt: string;
    }>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.taskId) searchParams.set("taskId", params.taskId);
    if (params?.tool) searchParams.set("tool", params.tool);
    const query = searchParams.toString();
    const data = await request<{
        success: boolean;
        data: {
            events: Array<{
                id: string;
                taskId: string;
                taskTitle?: string | null;
                actorId: string | null;
                actorRef?: { id: string; username: string } | null;
                runId: string | null;
                toolName: string;
                action: string;
                paramsHash: string;
                createdAt: string;
            }>;
            pagination: { page: number; limit: number; total: number; totalPages: number };
        };
    }>(`/api/admin/execution-audit${query ? `?${query}` : ""}`);
    return data.data;
}


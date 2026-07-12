import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "http";
import cors from "cors";
import { initSocket } from "./server/socket/index.js";
import { emitToConversation, emitToUser } from "./server/socket/emit.js";
import { SocketEvents } from "@semantask/types";
import {
    assertInternalAudienceConfigured,
    hasValidInternalSecret,
    INTERNAL_SECRET_HEADER,
    setCorrelationIdResolver,
} from "@semantask/types/utils/internal-bridge-auth";
import {
    ensureDefaultMetrics,
    getCorrelationId,
    prometheusContentType,
    renderPrometheusMetrics,
} from "@semantask/observability";
import { startTracing } from "@semantask/observability/tracing";
import {
    isOriginAllowed,
    parseCommaSeparatedValues,
} from "./server/socket/utils/url.js";
import { correlationMiddleware, logSocketEvent } from "./server/socket/observability.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const visitedEnvPaths = new Set<string>();
let scanDir = currentDir;

for (let depth = 0; depth < 8; depth++) {
    const envPath = path.join(scanDir, ".env");

    if (!visitedEnvPaths.has(envPath) && existsSync(envPath)) {
        loadEnv({ path: envPath });
        visitedEnvPaths.add(envPath);
    }

    const parent = path.dirname(scanDir);
    if (parent === scanDir) {
        break;
    }
    scanDir = parent;
}


const app = express();
const allowedOrigins = parseCommaSeparatedValues(process.env.ORIGIN);
app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin, allowedOrigins)) {
            return callback(null, true);
        }

        return callback(new Error("Origin not allowed"));
    },
    credentials: true,
}));
app.use(express.json());

ensureDefaultMetrics("socket");
startTracing("socket");
setCorrelationIdResolver(() => getCorrelationId());
app.use(correlationMiddleware);

app.get("/health", (_req, res) => {
    return res.status(200).json({
        status: "ok",
        service: "socket",
        uptime: Math.floor(process.uptime()),
    });
});

app.get("/metrics", async (_req, res) => {
    try {
        const body = await renderPrometheusMetrics();
        res.setHeader("Content-Type", prometheusContentType());
        return res.status(200).send(body);
    } catch (error) {
        return res.status(500).send(error instanceof Error ? error.message : "metrics error");
    }
});

assertInternalAudienceConfigured("socket");

app.use("/internal", (req, res, next) => {
    const providedSecret = req.header(INTERNAL_SECRET_HEADER);

    if (!hasValidInternalSecret(providedSecret, "socket")) {
        return res.status(401).json({ error: "Unauthorized internal request" });
    }

    next();
});

const server = http.createServer(app);

await initSocket(server);


app.post("/internal/message-deleted", (req, res) => {
    const { conversationId, payload } = req.body;

    if (!conversationId || !payload) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    emitToConversation(conversationId, SocketEvents.MESSAGE_DELETE, payload);

    return res.json({ success: true });
})
app.post("/internal/message-reaction", (req, res) => {
    const { conversationId, payload } = req.body;

    if (!conversationId || !payload) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    emitToConversation(conversationId, SocketEvents.MESSAGE_REACTION, payload);

    return res.json({ success: true });
});

app.post("/internal/message-delivered", (req, res) => {
    const { messageId, conversationId, userId, deliveredAt, senderId } = req.body || {};

    if (!messageId || !conversationId || !userId || !senderId) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    emitToUser(senderId, SocketEvents.MESSAGE_DELIVERED_UPDATE, {
        messageId,
        conversationId,
        userId,
        deliveredAt: deliveredAt || new Date().toISOString(),
    });

    return res.json({ success: true });
});

app.post("/internal/message-seen", (req, res) => {
    const { conversationId, messageIds, userId, seenAt } = req.body || {};

    if (!conversationId || !Array.isArray(messageIds) || messageIds.length === 0 || !userId) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    emitToConversation(conversationId, SocketEvents.MESSAGE_SEEN_UPDATE, {
        conversationId,
        messageIds,
        userId,
        seenAt: seenAt || new Date().toISOString(),
    });

    return res.json({ success: true });
});

app.post("/internal/conversation-created", (req, res) => {
    const { conversationId, participantIds } = req.body || {};

    if (!conversationId || !Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    const uniqueParticipantIds = Array.from(
        new Set(participantIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0))
    );

    if (uniqueParticipantIds.length === 0) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    for (const userId of uniqueParticipantIds) {
        emitToUser(userId, SocketEvents.CONVERSATION_CREATED, { conversationId });
    }

    return res.json({ success: true });
});

app.post("/internal/task-created", (req, res) => {
    const { conversationId, payload } = req.body || {};

    if (!conversationId || !payload) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    emitToConversation(conversationId, SocketEvents.TASK_CREATED, payload);
    return res.json({ success: true });
});

app.post("/internal/task-updated", (req, res) => {
    const { conversationId, payload } = req.body || {};

    if (!conversationId || !payload) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    emitToConversation(conversationId, SocketEvents.TASK_UPDATED, payload);
    return res.json({ success: true });
});

app.post("/internal/task-linked-to-message", (req, res) => {
    const { conversationId, payload } = req.body || {};

    if (!conversationId || !payload) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    emitToConversation(conversationId, SocketEvents.TASK_LINKED_TO_MESSAGE, payload);
    return res.json({ success: true });
});

app.post("/internal/task-execution-updated", (req, res) => {
    const { conversationId, payload } = req.body || {};

    if (!conversationId || !payload) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    logSocketEvent("info", {
        event: "socket.fanout.task_execution_updated",
        conversationId,
        taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
    });
    emitToConversation(conversationId, SocketEvents.TASK_EXECUTION_UPDATED, payload);
    return res.json({ success: true });
});

app.post("/internal/message-semantic-updated", (req, res) => {
    const { conversationId, payload } = req.body || {};

    if (!conversationId || !payload) {
        return res.status(400).json({ error: "Invalid payload" });
    }

    logSocketEvent("info", {
        event: "socket.fanout.message_semantic_updated",
        conversationId,
        messageId: typeof payload.messageId === "string" ? payload.messageId : undefined,
    });
    emitToConversation(conversationId, SocketEvents.MESSAGE_SEMANTIC_UPDATED, payload);
    return res.json({ success: true });
});

const port = parseInt(process.env.PORT || '3001', 10);
server.listen(port, '0.0.0.0', () => {
    logSocketEvent("info", { event: "socket.listening", port });
});

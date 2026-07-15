export const PRESENCE_HEARTBEAT_TTL_SECONDS = 12;
export const MESSAGE_DELIVERY_TTL_SECONDS = 60 * 60 * 24 * 7;

export const PRESENCE_PEERS_CACHE_TTL_SECONDS = 60;

export const redisKeys = {
    onlineUser: (userId: string) => `online_users:${userId}`,
    userSockets: (userId: string) => `user_sockets:${userId}`,
    userActiveConversation: (userId: string) => `user_active_conversation:${userId}`,
    userPresence: (userId: string) => `user_presence:${userId}`,
    presencePeers: (userId: string) => `presence_peers:${userId}`,
    messageDelivery: (messageId: string) => `message_delivery:${messageId}`,
    activeUsersSet: "active_users",
};

export type MessageDeliveryState = "sent" | "delivered" | "seen";

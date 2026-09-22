import { hashPassword } from "../../../packages/auth/password/hash";
import { Conversation } from "../../../packages/db/models/Conversation";
import MessageModel from "../../../packages/db/models/Message";
import OrganizationModel from "../../../packages/db/models/Organization";
import OrganizationMembershipModel from "../../../packages/db/models/OrganizationMembership";
import TaskModel from "../../../packages/db/models/Task";
import { User } from "../../../packages/db/models/User";
import WorkSuggestionModel from "../../../packages/db/models/WorkSuggestion";
import { connectToDatabase } from "../../../packages/db/db";
import { ALICE, BOB, E2E_ORG } from "./credentials";
import { E2E_MONGODB_URI } from "./env";

async function createUser(input: { username: string; email: string; password: string }) {
    const password = await hashPassword(input.password);
    return User.create({
        username: input.username,
        email: input.email,
        password,
        authProviders: ["password"],
        isVerified: new Date(),
        status: "active",
        role: "user",
        isOnline: false,
        conversations: [],
    });
}

export async function seedE2eWorld(): Promise<void> {
    process.env.MONGODB_URI = E2E_MONGODB_URI;
    await connectToDatabase();

    try {
        const dbName = User.db.name;
        if (!dbName?.endsWith("_e2e")) {
            throw new Error(
                `Refusing to drop database "${dbName ?? "<unknown>"}"; expected a name ending with "_e2e"`
            );
        }
        await User.db.dropDatabase();

        const alice = await createUser(ALICE);
        const bob = await createUser(BOB);

        const organization = await OrganizationModel.create({
            name: E2E_ORG.name,
            slug: E2E_ORG.slug,
            status: "active",
            createdBy: alice._id,
        });

        await OrganizationMembershipModel.create([
            { organizationId: organization._id, userId: alice._id, role: "owner" },
            { organizationId: organization._id, userId: bob._id, role: "member" },
        ]);

        // Personal DM so GET /api/conversations (no org cookie) returns it.
        const conversation = await Conversation.create({
            participants: [alice._id, bob._id],
            type: "direct",
            isGroup: false,
            organizationId: null,
        });

        alice.conversations.push(conversation._id);
        bob.conversations.push(conversation._id);
        await alice.save();
        await bob.save();

        const message = await MessageModel.create({
            sender: alice._id,
            content: "Please send the Friday report by 5pm.",
            conversationId: conversation._id,
            messageType: "text",
            status: "sent",
            semanticType: "task",
            semanticConfidence: 0.9,
            aiStatus: "classified",
        });

        conversation.lastMessage = {
            _id: message._id,
            sender: alice._id,
            messageType: "text",
            content: message.content,
            _creationTime: message.createdAt,
        };
        await conversation.save();

        const suggestion = await WorkSuggestionModel.create({
            messageId: message._id,
            conversationId: conversation._id,
            organizationId: null,
            status: "proposed",
            title: "Send the Friday report",
            summary: "Please send the Friday report by 5pm.",
            confidence: 0.9,
            candidates: {
                assigneeCandidates: [bob._id],
                dueAtCandidate: null,
                priorityCandidate: "medium",
            },
            extractorVersion: "e2e-seed",
        });

        await TaskModel.create({
            conversationId: conversation._id,
            organizationId: null,
            title: "Prepare weekly status",
            description: "Seeded coordination task for the e2e board.",
            status: "pending",
            lifecycleState: "ready",
            boardStatus: "todo",
            priority: "medium",
            assignees: [bob._id],
            createdBy: alice._id,
            source: "manual",
            suggestionId: suggestion._id,
            sourceMessageIds: [message._id],
            confidence: 1,
            tags: ["e2e"],
            dedupeKey: `e2e-seed-task-${conversation._id.toString()}`,
        });
    } finally {
        await User.base.disconnect();
    }
}

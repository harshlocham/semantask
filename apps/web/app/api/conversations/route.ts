import { connectToDatabase } from "@/lib/Db/db";
import { Conversation } from "@/models/Conversation";
import { User } from "@/models/User";
import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { resolveOrganizationContext } from "@/lib/utils/auth/resolveOrganizationContext";
import mongoose from "mongoose";
import { getInternalSocketServerUrl } from "@/lib/socket/socketConfig";
import { createInternalRequestHeaders } from "@semantask/types/utils/internal-bridge-auth";
import {
    assertUsersAreOrgMembers,
    assertOrganizationActive,
} from "@semantask/services/organization.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import { requireConversationAccess } from "@/lib/utils/auth/requireConversationAccess";


export async function POST(req: Request) {
    try {
        const guard = await requireAuthUser();
        if (guard.response) {
            return guard.response;
        }

        const orgContext = await resolveOrganizationContext(req, guard.user);
        if (orgContext.response) {
            return orgContext.response;
        }

        await connectToDatabase();

        const currentUserById = mongoose.Types.ObjectId.isValid(guard.user.id)
            ? await User.findById(guard.user.id)
            : null;
        const currentUser = currentUserById || (await User.findOne({ email: guard.user.email }));
        if (!currentUser) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const body = await req.json();
        const { participants, isGroup, groupName, image, admin, organizationId: bodyOrgId } = body;

        if (!participants || participants.length === 0) {
            return NextResponse.json({ error: "Participants required" }, { status: 400 });
        }

        const organizationId =
            (typeof bodyOrgId === "string" && bodyOrgId.trim()) || orgContext.organizationId;

        if (organizationId) {
            try {
                await assertOrganizationActive(organizationId);
                await assertUsersAreOrgMembers(organizationId, [
                    guard.user.id,
                    ...participants.map((p: string) => String(p)),
                ]);
            } catch (error) {
                if (error instanceof AuthorizationError) {
                    return NextResponse.json({ error: error.message }, { status: 403 });
                }
                throw error;
            }
        }

        // Check for existing conversation (only if not a group chat)
        if (!isGroup && participants.length === 2) {
            const existing = await Conversation.findOne({
                isGroup: false,
                participants: { $all: participants },
                ...(organizationId
                    ? { organizationId }
                    : {
                        $or: [
                            { organizationId: null },
                            { organizationId: { $exists: false } },
                        ],
                    }),
            });

            if (existing) {
                const populated = await existing.populate("participants", "username email profilePicture");
                return NextResponse.json(populated, { status: 200 });
            }
        }

        // Create new conversation
        const newConversation = await Conversation.create({
            isGroup,
            participants,
            organizationId: organizationId || null,
            ...(isGroup && {
                groupName,
                image,
                admin,
            }),
        });

        const populated = await newConversation.populate("participants", "username email profilePicture");

        const participantIds = (newConversation.participants || []).map((participant) => String(participant));
        const internalResponse = await fetch(`${getInternalSocketServerUrl()}/internal/conversation-created`, {
            method: "POST",
            headers: createInternalRequestHeaders(),
            body: JSON.stringify({
                conversationId: String(newConversation._id),
                participantIds,
            }),
        });

        if (!internalResponse.ok) {
            throw new Error("Failed to broadcast conversation creation");
        }

        return NextResponse.json(populated, { status: 201 });

    } catch (error) {
        console.error("POST /api/conversations error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}


export async function GET(req: Request) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const orgContext = await resolveOrganizationContext(req, guard.user);
    if (orgContext.response) {
        return orgContext.response;
    }

    try {
        await connectToDatabase();
        const userById = mongoose.Types.ObjectId.isValid(guard.user.id)
            ? await User.findById(guard.user.id)
            : null;
        const user = userById || (await User.findOne({ email: guard.user.email }));
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const orgFilter = orgContext.organizationId
            ? { organizationId: orgContext.organizationId }
            : {
                $or: [
                    { organizationId: null },
                    { organizationId: { $exists: false } },
                ],
            };

        const conversations = await Conversation.find({
            participants: user._id,
            ...orgFilter,
        })
            .populate("participants", "username email profilePicture")
            .populate({
                path: "lastMessage",
                populate: {
                    path: "sender",
                    select: "username email profilePicture",
                },
            })
            .sort({ updatedAt: -1 })
            .lean();

        return NextResponse.json(conversations, { status: 200 });
    } catch (error) {
        console.error("Error fetching conversations:", error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}

export async function DELETE(req: Request) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { conversationId } = await req.json();
    if (!conversationId || typeof conversationId !== "string") {
        return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const access = await requireConversationAccess(conversationId, guard.user);
    if (access.response) {
        return access.response;
    }

    await connectToDatabase();

    const deletedConv = await Conversation.findByIdAndDelete(conversationId);

    if (!deletedConv) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Conversation deleted successfully" });
}

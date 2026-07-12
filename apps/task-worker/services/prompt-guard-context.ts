import { Types } from "mongoose";
import ContactModel from "@semantask/db/models/Contact";
import { User } from "@semantask/db/models/User";
import { getConversationParticipantIds } from "@semantask/services/authorization.service";

export type PromptGuardEmailContext = {
    participantEmails: string[];
    contactEmails: string[];
    participantIds: string[];
};

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

/**
 * Load emails for conversation participants and the task owner's contacts.
 * Best-effort: returns empty arrays on failure so callers can degrade safely.
 */
export async function loadPromptGuardEmailContext(input: {
    conversationId: string;
    ownerUserId?: string | null;
}): Promise<PromptGuardEmailContext> {
    const empty: PromptGuardEmailContext = {
        participantEmails: [],
        contactEmails: [],
        participantIds: [],
    };

    try {
        if (!isValidObjectId(input.conversationId)) {
            return empty;
        }

        const participantIds = await getConversationParticipantIds(input.conversationId);
        const participantObjectIds = participantIds
            .filter((id) => Types.ObjectId.isValid(id))
            .map((id) => new Types.ObjectId(id));

        const participantEmails: string[] = [];
        if (participantObjectIds.length > 0) {
            const users = await User.find({ _id: { $in: participantObjectIds } })
                .select("email")
                .lean<{ email?: string }[]>();
            for (const user of users) {
                if (typeof user.email === "string" && user.email.trim()) {
                    participantEmails.push(user.email.trim().toLowerCase());
                }
            }
        }

        const contactEmails: string[] = [];
        if (isValidObjectId(input.ownerUserId)) {
            const contacts = await ContactModel.find({ userId: new Types.ObjectId(input.ownerUserId) })
                .select("email")
                .lean<{ email?: string }[]>();
            for (const contact of contacts) {
                if (typeof contact.email === "string" && contact.email.trim()) {
                    contactEmails.push(contact.email.trim().toLowerCase());
                }
            }
        }

        return {
            participantEmails,
            contactEmails,
            participantIds,
        };
    } catch (error) {
        console.warn("prompt_guard.context_load_failed", {
            conversationId: input.conversationId,
            error: error instanceof Error ? error.message : String(error),
        });
        return empty;
    }
}

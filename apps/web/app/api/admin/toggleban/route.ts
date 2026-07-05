import { NextResponse } from "next/server";
import { User } from "@/models/User";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAdminUser } from "@/lib/utils/auth/requireAdminUser";
import { clearCachedUserState } from "@/lib/utils/auth/userStateCache";
import { revokeUserAuthSessions } from "@semantask/auth";

export async function PATCH(req: Request) {
    const guard = await requireAdminUser();
    if (guard.response) {
        return guard.response;
    }

    const body = await req.json();
    const { id, status } = body;

    if (!id || (status !== "active" && status !== "banned")) {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const user = await User.findById(id);
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        user.status = status;
        user.isBanned = status === "banned";
        await user.save();

        await clearCachedUserState(String(user._id));

        if (status === "banned") {
            await revokeUserAuthSessions(String(user._id));
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error updating user status:", error);
        return NextResponse.json({ error: "Failed to update user status" }, { status: 500 });
    }
}
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn(async () => undefined),
}));

const userFindById = jest.fn<any>();
const notifyDedupeCreate = jest.fn<any>();
const notifyDedupeDeleteOne = jest.fn<any>();

jest.mock("@semantask/db/models/User", () => ({
    User: {
        findById: (...args: unknown[]) => userFindById(...args),
    },
}));

jest.mock("@semantask/db/models/NotifyDedupe", () => ({
    __esModule: true,
    default: {
        create: (...args: unknown[]) => notifyDedupeCreate(...args),
        deleteOne: (...args: unknown[]) => notifyDedupeDeleteOne(...args),
    },
}));

const fetchMock = jest.fn<any>();
(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

import { notifyUser } from "../notify.service";

describe("notify.service", () => {
    beforeEach(() => {
        userFindById.mockReset();
        notifyDedupeCreate.mockReset();
        notifyDedupeCreate.mockResolvedValue({});
        notifyDedupeDeleteOne.mockReset();
        notifyDedupeDeleteOne.mockResolvedValue({});
        fetchMock.mockReset();
        delete process.env.RESEND_API_KEY;
        delete process.env.RESEND_FROM_EMAIL;
        delete process.env.EMAIL_FROM;
        delete process.env.SOCKET_INTERNAL_URL;
    });

    it("resolves user and skips email when mail is not configured", async () => {
        userFindById.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    email: "alex@example.com",
                    username: "Alex",
                }),
            }),
        });

        await notifyUser({
            userId: new Types.ObjectId().toString(),
            kind: "task_assigned",
            subject: "Assigned",
            text: "You were assigned a task",
            dedupeKey: "test-1",
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(notifyDedupeCreate).toHaveBeenCalled();
        expect(notifyDedupeDeleteOne).toHaveBeenCalled();
    });

    it("sends via Resend when configured", async () => {
        process.env.RESEND_API_KEY = "re_test";
        process.env.RESEND_FROM_EMAIL = "noreply@semantask.test";
        userFindById.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    email: "alex@example.com",
                    username: "Alex",
                }),
            }),
        });
        fetchMock.mockResolvedValue({
            ok: true,
            text: async () => "",
        });

        await notifyUser({
            userId: new Types.ObjectId().toString(),
            kind: "task_assigned",
            subject: "Assigned",
            text: "You were assigned a task",
            dedupeKey: "test-2",
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.resend.com/emails",
            expect.objectContaining({
                method: "POST",
            })
        );
        expect(notifyDedupeDeleteOne).not.toHaveBeenCalled();
    });

    it("skips send when dedupe key was already claimed", async () => {
        notifyDedupeCreate.mockRejectedValue({ code: 11000 });
        process.env.RESEND_API_KEY = "re_test";
        process.env.RESEND_FROM_EMAIL = "noreply@semantask.test";

        await notifyUser({
            userId: new Types.ObjectId().toString(),
            kind: "task_overdue",
            subject: "Overdue",
            text: "Task is overdue",
            dedupeKey: "overdue:task:2026-08-25",
        });

        expect(userFindById).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

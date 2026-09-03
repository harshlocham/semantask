import { beforeEach, describe, expect, it } from "@jest/globals";
import {
    absoluteApprovalsHref,
    absoluteTaskHref,
    appOrigin,
    withAbsoluteCta,
} from "../notify-links";

describe("notify-links", () => {
    beforeEach(() => {
        delete process.env.APP_URL;
        delete process.env.PUBLIC_APP_URL;
    });

    it("prefers PUBLIC_APP_URL over APP_URL", () => {
        process.env.APP_URL = "https://app.example.com/";
        process.env.PUBLIC_APP_URL = "https://public.example.com/";
        expect(appOrigin()).toBe("https://public.example.com");
        expect(absoluteTaskHref("task-1")).toBe("https://public.example.com/work/task-1");
        expect(absoluteApprovalsHref()).toBe("https://public.example.com/inbox/approvals");
    });

    it("returns null absolute hrefs when origin is unset", () => {
        expect(appOrigin()).toBeNull();
        expect(absoluteTaskHref("task-1")).toBeNull();
        expect(withAbsoluteCta("<p>hi</p>", null, "Open")).toBe("<p>hi</p>");
    });
});

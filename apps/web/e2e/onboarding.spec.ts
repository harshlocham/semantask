/**
 * Journey 2: Register, OTP stub, wizard, and a visible first conversation.
 */
import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "./credentials";
import { waitForOtp } from "./mail";
import {
    GETTING_STARTED_GROUP_NAME,
    GETTING_STARTED_PROMPT,
} from "../lib/onboarding/constants";

test("register lands in a Getting started conversation", async ({ page }) => {
    const email = `onboard-${Date.now()}@e2e.semantask.test`;

    await page.goto("/register");
    await page.getByLabel("Full Name").fill("Onboard User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Send OTP" }).click();

    await expect(page.getByLabel("One-Time Password")).toBeVisible({ timeout: 15_000 });
    const otp = await waitForOtp(email);
    await page.getByLabel("One-Time Password").fill(otp);
    await page.getByRole("button", { name: "Verify & Login" }).click();

    await expect(page).toHaveURL("/onboarding", { timeout: 20_000 });
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();
    await expect(page.getByText("No conversations found")).toHaveCount(0);

    await page.getByTestId("onboarding-personal").click();

    await expect(page).toHaveURL(/\/c\/[a-f0-9]{24}/, { timeout: 20_000 });
    await expect(page.getByText(GETTING_STARTED_GROUP_NAME).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(GETTING_STARTED_PROMPT).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("No conversations found")).toHaveCount(0);
    await expect(page.getByTestId("conversations-empty")).toHaveCount(0);
});

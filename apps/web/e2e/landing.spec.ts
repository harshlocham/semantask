/**
 * Journey 1: Signed-out / is the landing page and does not redirect.
 */
import { expect, test } from "@playwright/test";
import { ALICE } from "./credentials";
import { APP_HOME } from "../lib/routes";

test.describe("signed-out landing", () => {
    test("stays on / and shows the three-step promise", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveURL("/");
        await expect(page.getByTestId("product-landing")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Conversation that becomes reviewable work" })).toBeVisible();
        await expect(page.getByTestId("landing-promise")).toBeVisible();
        await expect(page.getByText("Teams talk", { exact: true })).toBeVisible();
        await expect(page.getByText("Work is extracted for review", { exact: true })).toBeVisible();
        await expect(page.getByText("A manager approves when policy requires it", { exact: true })).toBeVisible();
        await expect(page.getByText("Autonomy is optional. Suggest-first is the default", { exact: false })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Welcome back" })).toHaveCount(0);
        await expect(page.getByLabel("Email")).toHaveCount(0);
    });

    test("Create account opens register and Sign in opens login", async ({ page }) => {
        await page.goto("/");
        await page.getByRole("link", { name: "Create account" }).click();
        await expect(page).toHaveURL("/register");

        await page.goto("/");
        await page.getByRole("link", { name: "Sign in" }).click();
        await expect(page).toHaveURL("/login");
    });
});

test("signed-in visit to / opens the workspace", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ALICE.email);
    await page.getByLabel("Password").fill(ALICE.password);
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page).toHaveURL(APP_HOME, { timeout: 20_000 });

    await page.goto("/");
    await expect(page).toHaveURL(APP_HOME, { timeout: 20_000 });
    await expect(page.getByText("Welcome to your workspace")).toBeVisible({ timeout: 20_000 });
    await expect(
        page.getByPlaceholder("Search or start a new chat").filter({ visible: true }),
    ).toBeVisible();
});

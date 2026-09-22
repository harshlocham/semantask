/**
 * Harness smoke only.
 *
 * Follow-on product journeys (later phases):
 * 1. Signed-out / is the landing page and does not redirect.
 * 2. Register, OTP stub, wizard, and a visible first conversation.
 * 3. Bad login shows one generic error. Good login opens the shell.
 * 4. Send a message, reply, reload, and the message is still there.
 * 5. A sentence becomes a suggestion; Accept puts it on the board.
 * 6. Dismiss removes a suggestion from the proposed list.
 * 7. Invite, accept, member sees the org, member cannot edit policy.
 * 8. Signed-out /inbox, /c/:id, and /work/:id redirect before paint.
 * 9. Board and dashboard are in the shell with default flags.
 * 10. The composer has no no-op control, and no screen claims E2E encryption.
 */
import { expect, test } from "@playwright/test";
import { ALICE } from "./credentials";

test("alice can sign in and the coordination board is reachable", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ALICE.email);
    await page.getByLabel("Password").fill(ALICE.password);
    await page.getByRole("button", { name: "Login" }).click();

    await expect(page).toHaveURL("/", { timeout: 20_000 });
    await expect(page.getByText("Welcome to your workspace")).toBeVisible({ timeout: 20_000 });
    await expect(
        page.getByPlaceholder("Search or start a new chat").filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText("Bob").filter({ visible: true })).toBeVisible();

    await page.goto("/inbox/board");
    await expect(page.getByTestId("inbox-subnav")).toBeVisible();
    await expect(page.getByTestId("inbox-nav-board")).toBeVisible();
    await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0);
});

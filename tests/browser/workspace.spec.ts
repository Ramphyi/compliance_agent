import { test, expect } from "@playwright/test";
test("temporary API limits keep users in the workspace with an actionable error", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "Rate limit reached. Try again shortly." }),
    }),
  );
  await page.goto("/app");
  await expect(
    page.getByText("Rate limit reached. Try again shortly.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});
test("landing, sample assessment, evidence review, policy, MCP key and onboarding", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Connect your code",
  );
  await page.screenshot({
    path: "test-results/landing-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Explore the workspace" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Problems & next steps",
    }),
  ).toBeVisible();
  await expect(page.getByText("50%", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Run assessment", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Assessment complete");
  await page
    .getByRole("button", { name: "Publish a clear privacy notice" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Why this is on your radar",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Evidence & review" })
    .click();
  await page.getByRole("button", { name: "Add evidence", exact: true }).click();
  await page
    .getByLabel("Requirement", { exact: true })
    .selectOption("data-rights");
  await page
    .getByLabel("Evidence title", { exact: true })
    .fill("Data rights procedure");
  await page
    .getByLabel("Evidence text", { exact: true })
    .fill(
      "Test record: documented access and deletion request procedure reviewed by the workspace owner.",
    );
  await page.getByRole("button", { name: "Submit evidence" }).click();
  const evidence = page.locator(".evidence-card").filter({
    has: page.getByRole("heading", { name: "Data rights procedure" }),
  });
  await expect(evidence).toContainText("submitted");
  await evidence.getByRole("button", { name: "Approve" }).click();
  await expect(evidence).toContainText("approved");
  await page.getByRole("link", { name: "Custom rules" }).click();
  await page.getByRole("button", { name: "Add custom policy" }).click();
  await page.getByLabel("Policy title").fill("European data residency");
  await page
    .getByLabel("What must be true?")
    .fill(
      "All production customer records must be stored in an approved European region.",
    );
  await page.getByRole("button", { name: "Add policy", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "European data residency" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Integrations", exact: true }).click();
  await page.getByRole("button", { name: "Create API key" }).click();
  await page.getByLabel("Key name").fill("Browser test integration");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  await expect(page.locator(".key-reveal")).toContainText("clr_");
  await page.getByRole("button", { name: "I saved it" }).click();
  await page.getByRole("button", { name: "Check release gate" }).click();
  await expect(page.getByText("Gate blocked", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke Browser test integration" })
    .click();
  await expect(
    page.getByRole("cell", { name: "Browser test integration" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Regulatory watch" }).click();
  await expect(
    page.getByRole("heading", { name: "EU Artificial Intelligence Act" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check sources" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace audit trail" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  expect(errors).toEqual([]);
});
test("mobile navigation and responsive layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/landing-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Explore the workspace" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Problems & next steps",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Check history", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Agent activity", exact: true }),
  ).toBeVisible();
});
test("authentication forms validate and configured-provider gaps are visible", async ({
  page,
}) => {
  await page.goto("/signup");
  await expect(
    page.getByRole("heading", { name: "Make room for clarity." }),
  ).toBeVisible();
  await expect(page.locator(".google")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByLabel("Full name").fill("Test Person");
  await page.getByLabel("Work email").fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("a");
  await page.getByRole("button", { name: "Create account" }).click();
  expect(
    await page
      .getByLabel("Password", { exact: true })
      .evaluate((el: HTMLInputElement) => el.validity.tooShort),
  ).toBe(true);
  await page.goto("/forgot");
  await page.getByLabel("Work email").fill("nonexistent@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If a password account exists",
  );
});

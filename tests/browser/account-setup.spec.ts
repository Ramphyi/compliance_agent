import { test, expect } from "@playwright/test";
test("account setup stores private access once and public projects require no token", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect your project", exact: true })
    .click();
  await page.getByRole("link", { name: "Account setup", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your connected accounts" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  await page
    .getByLabel("GitHub access token", { exact: true })
    .fill("browser-test-fake-credential");
  await page.getByRole("button", { name: "Save GitHub connection" }).click();
  await expect(
    page.getByText("GitHub access saved in your profile.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".provider-card").first()).toContainText(
    "Access saved",
  );
  expect(
    await page.locator(".account-connections input[type=password]").count(),
  ).toBe(0);
  await page.screenshot({
    path: "test-results/account-connections-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Your projects", exact: true }).click();
  await page
    .getByRole("button", { name: "New project", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Try the Reverse Office repository" })
    .click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Public repository No token needed/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByLabel("GitHub access token", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /Private repository Use the connection/ })
    .click();
  await expect(
    page.getByText(
      "Your saved account connection will be used for this scan.",
      { exact: false },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Public repository No token needed/ })
    .click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect GitHub" }).click();
  await expect(page.locator(".provider-card").first()).toContainText(
    "Not connected",
  );
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/account-connections-${width}.png`,
      fullPage: true,
    });
  }
});

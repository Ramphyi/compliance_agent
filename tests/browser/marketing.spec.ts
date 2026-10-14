import { test, expect } from "@playwright/test";
const paths = [
  "/",
  "/platform",
  "/solutions",
  "/solutions/saas",
  "/solutions/ai",
  "/solutions/mobile",
  "/solutions/embedded",
  "/integrations",
  "/security",
  "/pricing",
  "/field-notes",
  "/field-notes/memos",
  "/about",
];
test("Memos field note opens the real repository example for review", async ({
  page,
}) => {
  await page.goto("/field-notes/memos");
  await page.getByRole("button", { name: "Open the Memos example" }).click();
  await expect(page).toHaveURL("/app");
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "Evidence coverage" })
      .locator("strong"),
  ).toHaveText("0%");
  await expect(page.locator(".workspace-switch")).toContainText("Memos");
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Evidence & review" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pinned Memos repository metadata" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Integrations", exact: true }).click();
  await page.getByRole("button", { name: "Check release gate" }).click();
  await expect(page.getByText("Gate blocked", { exact: true })).toBeVisible();
});
for (const width of [1440, 768, 390, 320]) {
  test(`all 13 marketing pages load directly and fit at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 950 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page).toHaveTitle(/Clearance/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `horizontal overflow at ${path}`,
      ).toBe(true);
      expect(await page.locator("main").innerText()).not.toContain("undefined");
      await page.screenshot({
        path: `test-results/marketing-${width}-${path === "/" ? "home" : path.slice(1).replaceAll("/", "-")}.png`,
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}
test("navigation uses pages, handles back, resets scroll and exposes keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Product", exact: true })
    .click();
  await expect(page).toHaveURL("/platform");
  await expect(page.locator("h1")).toBeFocused();
  await page.locator(".m-footer").scrollIntoViewIfNeeded();
  await page
    .locator(".m-footer")
    .getByRole("link", { name: "Pricing", exact: true })
    .click();
  await expect(page).toHaveURL("/pricing");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL("/platform");
  await expect(page.locator("h1")).toBeVisible();
  await page.reload();
  await expect(page.locator("h1")).toContainText("release review");
  const hrefs = await page
    .locator(".m-header nav a")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
  expect(hrefs.every((x) => x?.startsWith("/") && !x.includes("#"))).toBe(true);
});
test("release examples, FAQs, calculator and copy controls work", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "AI product", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "What decisions does your model influence?",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mobile app", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Does the store disclosure match the app?",
    }),
  ).toBeVisible();
  await page
    .getByText("Will this certify my product?", { exact: true })
    .click();
  await expect(page.locator("details[open]")).toContainText(
    "qualified reviewers",
  );
  await page.goto("/pricing");
  await page.getByLabel("Monthly compliance hours").fill("40");
  await page.getByLabel("Assumed reduction", { exact: true }).fill("50");
  await expect(page.locator("output")).toContainText("20.0");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/integrations");
  await page.getByRole("button", { name: "Copy mcp.config.json" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "YOUR_CLEARANCE_API_KEY",
  );
});
test("mobile menu closes on navigation and Escape, and every internal destination exists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Field notes", exact: true })
    .click();
  await expect(page).toHaveURL("/field-notes");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).not.toBeVisible();
  const allowed = new Set([...paths, "/signup", "/login"]);
  for (const path of paths) {
    await page.goto(path);
    const links = await page
      .locator('.marketing a[href^="/"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
    for (const link of links)
      expect(allowed.has(link!), `Unknown link ${link} on ${path}`).toBe(true);
  }
});

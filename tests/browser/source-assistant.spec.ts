import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
let folder: string;
test.beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "clearance-source-browser-"));
  await mkdir(join(folder, "server"));
  await writeFile(
    join(folder, "README.md"),
    "# TeamDesk\nTeamDesk is a document collaboration service for teams to share files and discuss business projects.",
  );
  await writeFile(
    join(folder, "package.json"),
    '{"dependencies":{"react":"1","openai":"1"}}',
  );
  await writeFile(
    join(folder, "server", "app.ts"),
    "const email = user.email;\nconst db = postgres;\nif (!hasPermission(user, file)) return status(403);\nconst ai = openai;",
  );
  await writeFile(join(folder, ".env"), "SECRET_MUST_NOT_BE_SENT");
});
test.afterAll(async () => {
  const rel = relative(resolve(tmpdir()), resolve(folder));
  if (rel.startsWith("clearance-source-browser-") && !rel.includes(".."))
    await rm(resolve(folder), { recursive: true, force: true });
});
test("source scan prefills questions; draggable assistant explains real context and prepares reviewable rules", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect your project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New project", exact: true })
    .last()
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("TeamDesk scan");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/connect\?project=/);
  const pid = new URL(page.url()).searchParams.get("project")!;
  await page
    .getByLabel("Choose source folder", { exact: true })
    .setInputFiles(folder);
  await expect(
    page.getByText("3 source files ready", { exact: false }),
  ).toBeVisible();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/source-analysis") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Scan source and prefill answers" })
    .click();
  expect((await sent).postData()).not.toContain("SECRET_MUST_NOT_BE_SENT");
  await expect(
    page.getByText("Source analysis ready", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/source-analysis-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Review prefilled questions" }).click();
  await expect(
    page.getByLabel("What does this project do, and who uses it?", {
      exact: true,
    }),
  ).toHaveValue(/TeamDesk/);
  await expect(
    page.getByLabel("What personal data is collected, and where does it go?", {
      exact: true,
    }),
  ).toHaveValue(/server\/app.ts/);
  await expect(
    page.getByLabel("Where will you offer this product?", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Where will you offer this product?", { exact: true })
    .fill(
      "Adult business customers in the EU; deployment region to be confirmed.",
    );
  await page.getByRole("button", { name: "Save answers", exact: true }).click();
  await expect(
    page.getByText("Answers saved.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open project assistant" }).click();
  const chat = page.getByRole("dialog", { name: "Project assistant" });
  await chat
    .getByRole("button", { name: "Explain project", exact: true })
    .click();
  await expect(chat.getByRole("log")).toContainText("3 files analyzed");
  const before = await chat.boundingBox();
  const header = chat.locator(".assistant-header");
  const handle = await header.boundingBox();
  await page.mouse.move(handle!.x + 90, handle!.y + 20);
  await page.mouse.down();
  await page.mouse.move(handle!.x - 140, handle!.y - 30, { steps: 8 });
  await page.mouse.up();
  const after = await chat.boundingBox();
  expect(after!.x).toBeLessThan(before!.x - 100);
  await chat
    .getByLabel("Message project assistant")
    .fill(
      "Privacy and AI governance for document collaboration SaaS in the EU",
    );
  await chat
    .getByRole("button", { name: "Build rule set", exact: true })
    .click();
  await expect(chat.locator(".rule-draft")).toBeVisible();
  expect(
    (await (await page.request.get(`/api/projects/${pid}`)).json()).rules,
  ).toHaveLength(0);
  await chat
    .getByRole("button", { name: "Add these rules to project" })
    .click();
  await expect(
    chat.getByRole("button", { name: "Added to project" }),
  ).toBeDisabled();
  await chat
    .getByRole("button", { name: "Run assessment", exact: true })
    .click();
  await expect(chat.getByRole("log")).toContainText("Assessment saved");
  await page.screenshot({
    path: "test-results/project-assistant-desktop.png",
    fullPage: true,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await chat.getByRole("button", { name: "Reset chat position" }).click();
    const bounds = await chat.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/project-assistant-${width}.png`,
    });
  }
  await chat.getByRole("button", { name: "Close assistant" }).click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(`/app/policies?project=${pid}`);
  await expect(
    page.getByRole("heading", { name: "Build a rule set for this software" }),
  ).toBeVisible();
  await expect(page.locator(".policy-card").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/rule-builder-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

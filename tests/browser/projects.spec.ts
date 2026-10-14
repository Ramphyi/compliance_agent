import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let folder: string;
test.beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "clearance-browser-project-"));
  await mkdir(join(folder, "web"));
  await writeFile(
    join(folder, "web", "package.json"),
    JSON.stringify({
      dependencies: { react: "1", openai: "1" },
      scripts: { prepare: "DO_NOT_EXECUTE" },
    }),
  );
  await writeFile(
    join(folder, "web", "app.test.ts"),
    "TEST_CONTENT_NOT_UPLOADED",
  );
  await writeFile(join(folder, ".env"), "PRIVATE_VALUE_NOT_UPLOADED");
  await writeFile(join(folder, "LICENSE"), "MIT");
});
test.afterAll(async () => {
  if (folder.startsWith(join(tmpdir(), "clearance-browser-project-")))
    await rm(folder, { recursive: true, force: true });
});
test("new project connects a folder, adapts questions, saves answers and can be revisited and rechecked", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect your project", exact: true })
    .click();
  await expect(page).toHaveURL("/app/projects");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .last()
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Project Atlas");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/connect\?project=/);
  const pid = new URL(page.url()).searchParams.get("project")!;
  await page
    .getByText("Advanced: import filenames only, without source analysis", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Choose project folder", { exact: true })
    .setInputFiles(folder);
  await expect(
    page.getByRole("heading", { name: "Review before importing" }),
  ).toBeVisible();
  await expect(page.locator(".snapshot-preview")).toContainText("openai");
  const upload = page.waitForRequest(
    (r) => r.url().endsWith("/snapshot") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Import code metadata" }).click();
  const body = (await upload).postData()!;
  expect(body).not.toMatch(/PRIVATE_VALUE|TEST_CONTENT|DO_NOT_EXECUTE|\.env/);
  await expect(
    page.getByRole("heading", { name: "Code snapshot imported" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/project-connect-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Answer project questions", exact: true })
    .click();
  await expect(
    page.getByLabel("What does the AI do, and what data reaches the model?", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Product description", { exact: true })
    .fill(
      "An internal customer support portal used by adult business customers.",
    );
  await page.getByLabel("Industry", { exact: true }).selectOption("Healthcare");
  await expect(
    page.getByLabel("Does the software influence diagnosis or treatment?", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Industry", { exact: true }).selectOption("Technology");
  await expect(
    page.getByLabel("Does the software influence diagnosis or treatment?", {
      exact: true,
    }),
  ).toHaveCount(0);
  const answers = page.locator(".project-question textarea");
  for (let i = 0; i < (await answers.count()); i++)
    await answers
      .nth(i)
      .fill(
        "Owner confirmed the business context. Code references and implementation still need review.",
      );
  await page.screenshot({
    path: "test-results/project-questions-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save and run assessment" }).click();
  await expect(page).toHaveURL(`/app?project=${pid}`);
  await expect(
    page.getByRole("heading", { name: "What needs fixing?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish a clear privacy notice" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run assessment", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Assessment complete");
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Check history", exact: true })
    .click();
  await expect(page.locator(".history-list > button")).toHaveCount(2);
  await page.locator(".history-list > button").first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "Publish a clear privacy notice",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Connect code", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "MCP / IDE agent Continue with your coding agent",
    })
    .click();
  await page.getByRole("button", { name: "Refresh after agent sync" }).click();
  await expect(
    page.getByRole("heading", { name: "Code snapshot imported" }),
  ).toBeVisible();
  const state = await (
    await page.request.get(`/api/projects/${pid}/discovery`)
  ).json();
  expect(state.connection.provider).toBe("local");
  expect(state.connection.answers.purpose).toContain("Owner confirmed");
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "All projects" })
    .click();
  await page
    .getByRole("button", { name: "New project", exact: true })
    .last()
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Second project");
  await page
    .getByRole("button", { name: "Bitbucket Public or private repository" })
    .click();
  await page
    .getByLabel("Repository URL", { exact: true })
    .fill("https://bitbucket.org/team/second");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByLabel("Repository URL", { exact: true })).toHaveValue(
    "https://bitbucket.org/team/second",
  );
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "All projects" })
    .click();
  await expect(page.locator(".project-tile")).toHaveCount(2);
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: "Project Atlas" }) })
    .click();
  await expect(page).toHaveURL(`/app?project=${pid}`);
  await page.reload();
  await expect(page.getByLabel("Select project")).toHaveValue(pid);
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "Project questions" })
    .click();
  await expect(
    page.getByLabel("What does this project do, and who uses it?", {
      exact: true,
    }),
  ).toHaveValue(/Owner confirmed/);
  expect(errors).toEqual([]);
});
test("project setup, questions and MCP handoff fit on narrow screens", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect your project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New project", exact: true })
    .last()
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Mobile project");
  await page
    .getByRole("button", {
      name: "MCP / IDE agent Continue with your coding agent",
    })
    .click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Keep working in your IDE" }),
  ).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .getByRole("button", {
      name: "Copy Continue with your coding agent",
      exact: true,
    })
    .click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain(new URL(page.url()).searchParams.get("project"));
  expect(prompt).toContain("answer_project_questions");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/project-connect-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: /Answer questions/ }).click();
  await expect(
    page.getByLabel("What does this project do, and who uses it?", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/project-questions-320.png",
    fullPage: true,
  });
});

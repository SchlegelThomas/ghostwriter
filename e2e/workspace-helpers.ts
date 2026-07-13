import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText(/Welcome,/)).toBeVisible();
}

export async function createProject(
  page: Page,
  title: string,
  firstBookTitle: string
): Promise<void> {
  await page.getByLabel("Project title").fill(title);
  await page.getByLabel("First book title").fill(firstBookTitle);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
}

export async function openProject(page: Page, title: string): Promise<void> {
  await page.getByLabel(`Project ${title}`).click();
}

export async function selectTree(page: Page, label: string): Promise<void> {
  const item = page.getByRole("treeitem", { name: label });
  await item.focus();
  try {
    await item.click({ timeout: 3_000 });
  } catch {
    await item.click({ force: true });
  }
  if ((await item.getAttribute("aria-selected")) !== "true") {
    await item.press("Enter");
  }
  await expect(item).toHaveAttribute("aria-selected", "true");
}

export async function commitInspectorField(
  page: Page,
  label: string,
  value: string
): Promise<void> {
  const field = page.getByLabel(label);
  await field.fill(value);
  await field.blur();
  await expect(page.getByText("Saved to project").first()).toBeVisible({
    timeout: 10_000
  });
  await dismissAcknowledgementToasts(page);
}

export async function addTreeChild(
  page: Page,
  parentLabel: string,
  addTrigger: string | RegExp,
  title: string,
  submitButton: string | RegExp,
  childTreeLabel: string | RegExp
): Promise<void> {
  await selectTree(page, parentLabel);
  const addButton = page.getByRole("button", { name: addTrigger });
  try {
    await addButton.click({ timeout: 3_000 });
  } catch {
    await addButton.click({ force: true });
  }
  const input = page.getByPlaceholder(/New .+ title/);
  await input.fill(title);
  await input.press("Enter");
  await expect(page.getByRole("treeitem", { name: childTreeLabel })).toBeVisible();
}

export async function addBook(
  page: Page,
  projectTitle: string,
  bookTitle: string
): Promise<void> {
  await addTreeChild(
    page,
    `Project ${projectTitle}`,
    `Add book to ${projectTitle}`,
    bookTitle,
    "Add book",
    `Book ${bookTitle}`
  );
}

export async function addPart(
  page: Page,
  bookTitle: string,
  partTitle: string
): Promise<void> {
  await addTreeChild(
    page,
    `Book ${bookTitle}`,
    `Add part to ${bookTitle}`,
    partTitle,
    "Add part",
    `Part ${partTitle}`
  );
}

export async function addChapter(
  page: Page,
  partTitle: string,
  chapterTitle: string
): Promise<void> {
  await addTreeChild(
    page,
    `Part ${partTitle}`,
    `Add chapter to ${partTitle}`,
    chapterTitle,
    "Add chapter",
    `Chapter ${chapterTitle}`
  );
}

export async function addSceneToChapter(
  page: Page,
  chapterTitle: string,
  sceneTitle: string
): Promise<void> {
  await addTreeChild(
    page,
    `Chapter ${chapterTitle}`,
    `Add scene to ${chapterTitle}`,
    sceneTitle,
    "Add scene",
    `Scene ${sceneTitle}`
  );
}

export async function addUnassignedScene(
  page: Page,
  bookTitle: string,
  sceneTitle: string
): Promise<void> {
  await addTreeChild(
    page,
    `Unassigned scenes in ${bookTitle}`,
    "Add scene to Unassigned",
    sceneTitle,
    "Add scene",
    `Scene ${sceneTitle}`
  );
}

export async function addStoryKnowledge(
  page: Page,
  label: string
): Promise<void> {
  await dismissAcknowledgementToasts(page);
  await selectTree(page, "Project folder Story knowledge");
  await page
    .getByRole("button", { name: "Add story record to Story knowledge" })
    .click();
  await page.getByRole("textbox").last().fill(label);
  await page
    .getByRole("button", { name: "Add story record", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: `Story knowledge ${label}` })
  ).toBeVisible({ timeout: 15_000 });
}

export async function openDraftScene(
  page: Page,
  sceneLabel: string
): Promise<void> {
  const item = page.getByRole("treeitem", { name: sceneLabel });
  await item.click();
  await item.press("Enter");
  await expect(page.getByText("Focused Draft").first()).toBeVisible();
}

export async function openWorkspaceMode(
  page: Page,
  mode: "Draft" | "Canvas" | "Split" | "Reader"
): Promise<void> {
  const wideLabels = {
    Draft: "D Draft",
    Canvas: "C Canvas",
    Split: "S Split",
    Reader: "R Reader"
  } as const;
  const wideButton = page.getByRole("button", { name: wideLabels[mode] });
  if (await wideButton.count()) {
    await wideButton.click();
    return;
  }
  await page
    .locator('[aria-label="Writing workspace modes"]')
    .getByRole("button", { name: mode, exact: true })
    .click();
}

export async function showInspectorIfHidden(page: Page): Promise<void> {
  const showInspector = page.getByRole("button", { name: "Show inspector" }).first();
  if (await showInspector.isVisible()) {
    await showInspector.click();
  }
}

export async function dismissAcknowledgementToasts(page: Page): Promise<void> {
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  while (await dismiss.count()) {
    await dismiss.first().click();
  }
}

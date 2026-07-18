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
  await page
    .getByRole("button", { name: `Project ${title}`, exact: true })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "← Projects" })).toBeVisible();
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
  await page.getByPlaceholder("New story record title").fill(label);
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
  await expect(page.getByLabel("Draft Desk")).toBeVisible();
}

export async function openDraftHistory(page: Page): Promise<void> {
  const closeHistory = page.getByRole("button", { name: "Close History" });
  if (await closeHistory.isVisible().catch(() => false)) {
    return;
  }
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByLabel("Draft History drawer")).toBeVisible();
}

function canvasToolDock(page: Page) {
  return page.getByLabel("Canvas tool dock");
}

function canvasUtilityBar(page: Page) {
  return page.getByLabel("Canvas utility bar");
}

export async function activateCanvasTool(
  page: Page,
  label: string,
  shortcut: string
): Promise<void> {
  await canvasToolDock(page)
    .getByRole("button", { name: `${label} (${shortcut})` })
    .click();
}

export async function createCanvasNote(page: Page): Promise<void> {
  await activateCanvasTool(page, "Note", "N");
}

export async function createCanvasRegion(page: Page): Promise<void> {
  await activateCanvasTool(page, "Region", "R");
}

export async function createCanvasImageReference(page: Page): Promise<void> {
  await activateCanvasTool(page, "Image reference", "I");
}

export async function openCanvasSceneTool(page: Page): Promise<void> {
  await activateCanvasTool(page, "Scene", "S");
  await expect(page.getByLabel("Storyboard scene handoff")).toBeVisible();
}

export async function placeSelectedDraftSceneOnCanvas(page: Page): Promise<void> {
  await openCanvasSceneTool(page);
  const handoff = page.getByLabel("Storyboard scene handoff");
  await handoff
    .getByRole("button", { name: "Place selected Draft scene" })
    .click();
  await expect(page.getByText("Scene placed on Canvas").first()).toBeVisible({
    timeout: 10_000
  });
  const cancel = handoff.getByRole("button", { name: "Cancel scene tool" });
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
  }
  await showCanvasDetailsIfHidden(page);
}

export async function placeStoryKnowledgeOnCanvas(
  page: Page,
  label: string
): Promise<void> {
  await activateCanvasTool(page, "Story record", "K");
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page
    .getByLabel("Story knowledge placement")
    .getByRole("button", { name: new RegExp(`^${escaped} ·`) })
    .click();
  await page.getByRole("button", { name: `Place ${label} on Canvas` }).click();
}

export async function showCanvasHistory(page: Page): Promise<void> {
  await canvasUtilityBar(page)
    .getByRole("button", { name: "Show Canvas history" })
    .click();
}

export async function hideCanvasHistory(page: Page): Promise<void> {
  await canvasUtilityBar(page)
    .getByRole("button", { name: "Hide Canvas history" })
    .click();
}

export async function openWorkspaceMode(
  page: Page,
  mode: "Draft" | "Canvas" | "Split" | "Reader"
): Promise<void> {
  // RN web may concatenate glyph + label ("CCanvas") or keep a space ("C Canvas").
  const wideLabels = {
    Draft: /D\s*Draft/,
    Canvas: /C\s*Canvas/,
    Split: /S\s*Split/,
    Reader: /R\s*Reader/
  } as const;
  const wideButton = page
    .getByLabel("Project areas")
    .getByRole("button", { name: wideLabels[mode] });
  const narrowButton = page
    .getByLabel("Writing workspace modes")
    .getByRole("button", { name: mode, exact: true });
  const modeButton = wideButton.or(narrowButton).first();
  await expect(modeButton).toBeVisible();
  await modeButton.click();
}

export async function showCanvasDetailsIfHidden(page: Page): Promise<void> {
  const showDetails = page
    .getByLabel("Canvas utility bar")
    .getByRole("button", { name: "Show Details" });
  if (await showDetails.isVisible().catch(() => false)) {
    await showDetails.click();
  }
}

export async function dismissAcknowledgementToasts(page: Page): Promise<void> {
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  while (await dismiss.count()) {
    await dismiss.first().click();
  }
}

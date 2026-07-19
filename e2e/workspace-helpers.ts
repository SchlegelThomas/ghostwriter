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

function historyRailButton(page: Page) {
  return page.getByRole("button", { name: /^◷ History/ });
}

export async function editPenName(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Edit writer profile" }).click();
  await expect(page.getByLabel("Writer profile dialog")).toBeVisible();
  await page.getByLabel("Pen name").fill(name);
}

export async function saveWriterProfile(page: Page): Promise<void> {
  const saveButton = page.getByRole("button", { name: "Save profile" });
  if (!(await saveButton.isEnabled().catch(() => false))) {
    await page.getByRole("button", { name: "Close profile editor" }).click();
    return;
  }
  await saveButton.click();
}

export async function setWriterPenName(page: Page, name: string): Promise<void> {
  if (await page.getByText(`Welcome, ${name}`).isVisible().catch(() => false)) {
    return;
  }
  await editPenName(page, name);
  await saveWriterProfile(page);
}

/** Project-mode acknowledgements live in the left-rail History panel. */
export async function openActivityHistory(page: Page): Promise<void> {
  const panel = page.getByLabel("Notifications and history");
  if (await panel.isVisible().catch(() => false)) {
    return;
  }
  await historyRailButton(page).click();
  await expect(panel).toBeVisible({ timeout: 10_000 });
}

export async function expectAcknowledgement(
  page: Page,
  title: string | RegExp
): Promise<void> {
  const canvasVisible = await page
    .getByLabel("Story Canvas workspace")
    .isVisible()
    .catch(() => false);
  if (canvasVisible) {
    await showCanvasHistory(page);
    await expect(
      page.getByLabel("Canvas history").getByText(title).first()
    ).toBeVisible({ timeout: 10_000 });
    return;
  }
  await openActivityHistory(page);
  await expect(
    page.getByLabel("Notifications and history").getByText(title).first()
  ).toBeVisible({ timeout: 10_000 });
}

export async function ensureSelectionInspectorVisible(
  page: Page
): Promise<void> {
  await dismissAcknowledgementToasts(page);

  const inspector = page.getByLabel("Selection inspector");
  if (await inspector.isVisible().catch(() => false)) {
    return;
  }

  const draftDesk = page.getByLabel("Draft Desk");
  if (await draftDesk.isVisible().catch(() => false)) {
    const contextDock = page.getByLabel("Draft Context Dock", { exact: true });
    const contextTabs = page.getByLabel("Draft Context Dock tabs");
    if (
      !(await contextDock.isVisible().catch(() => false)) &&
      !(await contextTabs.isVisible().catch(() => false))
    ) {
      await draftDesk.getByRole("button", { name: "Context" }).click();
    }
    await expect(contextDock).toBeVisible({ timeout: 5_000 });
    const briefTab = contextTabs.getByRole("tab", { name: "Brief" });
    if (await briefTab.isVisible().catch(() => false)) {
      await briefTab.click();
    }
  }

  await expect(inspector).toBeVisible({ timeout: 10_000 });
}

export async function moveSceneToDestination(
  page: Page,
  destinationLabel: string
): Promise<void> {
  await ensureSelectionInspectorVisible(page);
  const inspector = page.getByLabel("Selection inspector");
  const moveButton = inspector.getByRole("button", {
    name: `Move scene to ${destinationLabel}`
  });
  if (await moveButton.isVisible().catch(() => false)) {
    await moveButton.click();
    return;
  }
  await inspector.getByLabel("Find scene destination").fill(destinationLabel);
  await expect(moveButton).toBeVisible({ timeout: 10_000 });
  await moveButton.click();
}

export function canvasStoryKnowledge(page: Page, label: string) {
  return page
    .getByLabel("Story Canvas workspace")
    .getByLabel(`Story knowledge ${label}`);
}

export async function commitInspectorField(
  page: Page,
  label: string,
  value: string
): Promise<void> {
  const field = page.getByLabel(label);
  await field.fill(value);
  await field.blur();
  await expectAcknowledgement(page, /Saved to project/);
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
  const drawer = page.getByLabel("Draft History drawer");
  if (await drawer.isVisible().catch(() => false)) {
    return;
  }
  await page
    .getByLabel("Draft Desk")
    .getByRole("button", { name: "History", exact: true })
    .click();
  await expect(drawer).toBeVisible();
}

function canvasToolDock(page: Page) {
  return page.getByLabel("Canvas tools");
}

function canvasUtilityBar(page: Page) {
  return page.getByLabel("Canvas utilities");
}

export async function activateCanvasTool(
  page: Page,
  label: string,
  shortcut: string
): Promise<void> {
  await canvasToolDock(page)
    .getByRole("button", { name: `${label} · ${shortcut}` })
    .click();
}

/**
 * Narrow Map is outline-only (<760). Widening alone leaves `view === "outline"`,
 * so Spatial must be selected before `#story-canvas-surface` exists.
 */
export async function ensureSpatialCanvasSurface(page: Page): Promise<{
  restoreNarrow: boolean;
  previousViewport: { width: number; height: number } | null;
}> {
  const surface = page.locator("#story-canvas-surface");
  const viewport = page.viewportSize();
  const restoreNarrow =
    viewport !== null &&
    viewport.width < 760 &&
    !(await surface.isVisible().catch(() => false));
  if (restoreNarrow && viewport !== null) {
    await page.setViewportSize({ width: 800, height: viewport.height });
  }
  // Wait for the compact→wide chrome to publish Spatial before clicking.
  const spatial = canvasUtilityBar(page).getByRole("button", {
    name: "Spatial view"
  });
  await expect(spatial).toBeVisible({ timeout: 10_000 });
  await spatial.click();
  await expect(surface).toBeVisible({ timeout: 10_000 });
  return { restoreNarrow, previousViewport: viewport };
}

/**
 * RN web's board handler requires locationX/Y from an element click with position.
 * page.mouse.click often omits those fields, so armed place tools silently no-op.
 */
export async function placeArmedCanvasToolOnSurface(page: Page): Promise<void> {
  const surface = page.locator("#story-canvas-surface");
  await expect(surface).toBeVisible({ timeout: 10_000 });
  const box = await surface.boundingBox();
  if (!box) throw new Error("missing canvas surface");
  // Prefer a near-corner hit so existing cards near board center are not selected.
  await surface.click({
    position: {
      x: Math.min(36, Math.max(8, box.width * 0.08)),
      y: Math.min(36, Math.max(8, box.height * 0.08))
    }
  });
}

export async function createCanvasNote(page: Page): Promise<void> {
  const { restoreNarrow, previousViewport } =
    await ensureSpatialCanvasSurface(page);
  // Re-arm after Spatial chrome clicks so place tool stays selected.
  await activateCanvasTool(page, "Note", "N");
  await placeArmedCanvasToolOnSurface(page);
  if (restoreNarrow && previousViewport !== null) {
    await page.setViewportSize(previousViewport);
  }
  await expect(
    page
      .getByLabel(/^Writer note/)
      .or(page.getByRole("button", { name: /Canvas object \d+: Writer note,/ }))
      .first()
  ).toBeVisible({ timeout: 10_000 });
  await showCanvasDetailsIfHidden(page);
}

export async function createCanvasRegion(page: Page): Promise<void> {
  await ensureSpatialCanvasSurface(page);
  await activateCanvasTool(page, "Region", "R");
  await placeArmedCanvasToolOnSurface(page);
  await expect(page.getByLabel(/^Region /).first()).toBeVisible({
    timeout: 10_000
  });
  await showCanvasDetailsIfHidden(page);
}

export async function createCanvasImageReference(page: Page): Promise<void> {
  await ensureSpatialCanvasSurface(page);
  await activateCanvasTool(page, "Image reference", "I");
  await placeArmedCanvasToolOnSurface(page);
  await expect(
    page.getByLabel(/Image metadata|Concept image reference/).first()
  ).toBeVisible({ timeout: 10_000 });
  await showCanvasDetailsIfHidden(page);
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
  await expect(handoff).toHaveCount(0, { timeout: 10_000 });
  await showCanvasDetailsIfHidden(page);
}

export async function expectCanvasHistoryTitle(
  page: Page,
  title: string | RegExp
): Promise<void> {
  await showCanvasHistory(page);
  await expect(page.getByLabel("Canvas history").getByText(title)).toBeVisible({
    timeout: 10_000
  });
  await hideCanvasHistory(page);
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
  await showCanvasDetailsIfHidden(page);
}

/** Map-dense Canvas history opens from the left-rail ◷ History control. */
export async function showCanvasHistory(page: Page): Promise<void> {
  const panel = page.getByLabel("Canvas history");
  if (await panel.isVisible().catch(() => false)) {
    return;
  }
  await historyRailButton(page).click();
  await expect(panel).toBeVisible({ timeout: 10_000 });
}

export async function hideCanvasHistory(page: Page): Promise<void> {
  const panel = page.getByLabel("Canvas history");
  if (await panel.isVisible().catch(() => false)) {
    const close = panel.getByRole("button", { name: "Close" });
    if (await close.isVisible().catch(() => false)) {
      await close.click();
    }
  }
  const selected = page.getByRole("button", { name: "◷ History, selected" });
  if (await selected.isVisible().catch(() => false)) {
    await historyRailButton(page).click();
  }
}

/** ReadingSpine defaults minimized; drift copy appears in expanded chrome. */
export async function expandReadingSpine(page: Page): Promise<void> {
  const expandedRule = page.getByText(
    "Canvas position never silently reorders the manuscript."
  );
  if (await expandedRule.isVisible().catch(() => false)) {
    return;
  }
  const toggle = page.getByRole("button", {
    name: /Reading-order spine, \d+ scenes\. Activate to change size\./
  });
  await expect(toggle).toBeVisible();
  // Cycle minimized → bubbles → expanded (at most two clicks from minimized).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await expandedRule.isVisible().catch(() => false)) {
      return;
    }
    await toggle.click();
  }
  await expect(expandedRule).toBeVisible({ timeout: 5_000 });
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
  const inspector = page.getByLabel("Canvas inspector");
  if (await inspector.isVisible().catch(() => false)) {
    return;
  }
  const showDetails = page
    .getByLabel("Canvas utilities")
    .getByRole("button", { name: /Show Details/ });
  if (await showDetails.isVisible().catch(() => false)) {
    await showDetails.click();
  }
  await expect(inspector).toBeVisible({ timeout: 5_000 });
}

export async function dismissAcknowledgementToasts(page: Page): Promise<void> {
  const canvasVisible = await page
    .getByLabel("Story Canvas workspace")
    .isVisible()
    .catch(() => false);
  if (canvasVisible) {
    if (await page.getByLabel("Canvas history").isVisible().catch(() => false)) {
      await hideCanvasHistory(page);
    }
    return;
  }
  const panel = page.getByLabel("Notifications and history");
  if (!(await panel.isVisible().catch(() => false))) {
    return;
  }
  const dismiss = panel.getByRole("button", { name: "Dismiss" });
  while (await dismiss.count()) {
    await dismiss.first().click();
  }
  const close = page.getByRole("button", { name: "Close history" });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  }
}

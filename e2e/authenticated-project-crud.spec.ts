import { expect, test } from "@playwright/test";
import {
  addBook,
  addChapter,
  addPart,
  addSceneToChapter,
  addStoryKnowledge,
  addUnassignedScene,
  commitInspectorField,
  activateCanvasTool,
  canvasStoryKnowledge,
  createCanvasImageReference,
  createCanvasNote,
  createCanvasRegion,
  createProject,
  dismissAcknowledgementToasts,
  editPenName,
  ensureSelectionInspectorVisible,
  ensureSpatialCanvasSurface,
  expandReadingSpine,
  expectAcknowledgement,
  expectCanvasHistoryTitle,
  hideCanvasHistory,
  openCanvasSceneTool,
  placeArmedCanvasToolOnSurface,
  openDraftHistory,
  openDraftScene,
  openProject,
  openWorkspaceMode,
  placeSelectedDraftSceneOnCanvas,
  placeStoryKnowledgeOnCanvas,
  saveWriterProfile,
  selectTree,
  setWriterPenName,
  showCanvasDetailsIfHidden,
  showCanvasHistory,
  signIn
} from "./workspace-helpers.js";

test("writer signs in and manages a durable project hierarchy", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await expect(page.getByText(/Welcome,/)).toBeVisible();
  // Retries share the hermetic E2E server process; clear leftover projects first.
  for (;;) {
    const leftover = page.getByRole("button", { name: /^Project / }).first();
    if (!(await leftover.isVisible().catch(() => false))) break;
    await leftover.click();
    await expect(page.getByRole("button", { name: "← Projects" })).toBeVisible();
    await page.getByRole("button", { name: "Archive project" }).click();
    await page.getByRole("button", { name: "Confirm archive project" }).click();
    await page.getByRole("button", { name: "← Projects" }).click();
    await expect(page.getByText("Continue your story")).toBeVisible();
  }
  await expect(page.getByText("No projects yet")).toBeVisible({
    timeout: 15_000
  });

  await setWriterPenName(page, "Test Novelist");
  await expect(page.getByText("Welcome, Test Novelist")).toBeVisible();
  await expect(page.getByText("Profile saved")).toBeVisible();

  await createProject(page, "The Glass Harbor", "Book of Tides");
  await expectAcknowledgement(page, /Saved to project/);
  await dismissAcknowledgementToasts(page);

  await commitInspectorField(page, "Project title", "The Glass Harbor Cycle");

  await addBook(page, "The Glass Harbor Cycle", "Book of Storms");
  await selectTree(page, "Book Book of Storms");
  await commitInspectorField(page, "Book title", "Book of Storms Revised");
  await page.getByRole("button", { name: "Drafting" }).first().click();
  await dismissAcknowledgementToasts(page);
  await page
    .getByLabel("Selection inspector")
    .getByRole("button", { name: "Move book up" })
    .click();
  await page.getByRole("button", { name: "Archive book" }).click();
  await page.getByRole("button", { name: "Confirm archive book" }).click();
  await page.getByRole("button", { name: "Restore book" }).click();
  await selectTree(page, "Book Book of Tides");

  await addPart(page, "Book of Tides", "Part One");
  await addPart(page, "Book of Tides", "Empty Part");
  await selectTree(page, "Part Empty Part");
  await commitInspectorField(page, "Part title", "Temporary Part");
  await page
    .getByLabel("Persistent manuscript tree")
    .getByRole("button", { name: "Move Part up", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove empty part" }).click();
  await page.getByRole("button", { name: "Confirm remove part" }).click();
  await selectTree(page, "Part Part One");
  await addChapter(page, "Part One", "Low Water");
  await addChapter(page, "Part One", "Empty Chapter");
  await selectTree(page, "Chapter Empty Chapter");
  await commitInspectorField(page, "Chapter title", "Temporary Chapter");
  await page
    .getByLabel("Persistent manuscript tree")
    .getByRole("button", { name: "Move Chapter up", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove empty chapter" }).click();
  await page.getByRole("button", { name: "Confirm remove chapter" }).click();
  await selectTree(page, "Chapter Low Water");
  await addSceneToChapter(page, "Low Water", "The Empty Pier");
  await addSceneToChapter(page, "Low Water", "The Bell Below");
  await selectTree(page, "Scene The Bell Below");
  await page
    .getByLabel("Persistent manuscript tree")
    .getByRole("button", { name: "Move Scene up", exact: true })
    .click();
  await expectAcknowledgement(page, "Scene reordered");
  await dismissAcknowledgementToasts(page);
  await expect(page.getByRole("treeitem", { name: "Scene The Empty Pier" })).toBeVisible();
  const manuscriptTree = page.getByLabel("Persistent manuscript tree");
  await expect(async () => {
    const sceneOrder = await manuscriptTree
      .locator(
        '[aria-label="Scene The Bell Below"], [aria-label="Scene The Empty Pier"]'
      )
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label"))
      );
    expect(sceneOrder.slice(0, 2)).toEqual([
      "Scene The Bell Below",
      "Scene The Empty Pier"
    ]);
  }).toPass();
  await addChapter(page, "Part One", "High Water");
  await selectTree(page, "Scene The Empty Pier");
  await page
    .getByRole("button", {
      name: "Move scene to Book of Tides · Part One · High Water"
    })
    .click();

  await page.getByLabel("Scene summary").fill("Mara finds the harbor abandoned.");
  await page.getByLabel("Scene summary").blur();

  await addStoryKnowledge(page, "Mara Venn");
  await expect(page.getByText("Mara Venn").first()).toBeVisible();

  await selectTree(page, "Story knowledge Mara Venn");
  await page
    .getByRole("button", { name: "Link The Empty Pier" })
    .click();
  await expect(page.getByText(/1 total scene links/)).toBeVisible();

  const treeSearch = page.getByLabel("Search manuscript tree");
  await treeSearch.fill("The Empty Pier");
  await selectTree(page, "Scene The Empty Pier");
  await treeSearch.fill("");
  await page.getByRole("button", { name: "Archive scene" }).click();
  await page.getByRole("button", { name: "Confirm archive scene" }).click();
  await expect(page.getByRole("button", { name: "Restore scene" })).toBeVisible();
  await page.getByRole("button", { name: "Restore scene" }).click();

  await selectTree(page, "Story knowledge Mara Venn");
  await page
    .getByRole("button", { name: "Unlink The Empty Pier" })
    .click();
  await page.getByRole("button", { name: "Confirmed" }).last().click();
  await dismissAcknowledgementToasts(page);
  await page.getByRole("button", { name: "Archive story knowledge" }).click();
  await page
    .getByRole("button", { name: "Confirm archive story knowledge" })
    .click();
  await page.getByRole("button", { name: "Restore story knowledge" }).click();

  await page.getByRole("button", { name: "← Projects" }).click();
  await expect(page.getByText("Continue your story")).toBeVisible();
  await openProject(page, "The Glass Harbor Cycle");
  // Search reveals scenes under collapsed chapters after a project reopen.
  await treeSearch.fill("The Empty Pier");
  await selectTree(page, "Scene The Empty Pier");
  await treeSearch.fill("");
  await expect(page.getByLabel("Scene summary")).toHaveValue(
    "Mara finds the harbor abandoned."
  );

  await selectTree(page, "Project The Glass Harbor Cycle");
  await page.getByRole("button", { name: "Archive project" }).click();
  await page.getByRole("button", { name: "Confirm archive project" }).click();
  await page.getByRole("button", { name: "← Projects" }).click();
  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.getByRole("button", { name: "Show archived" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
  await openProject(page, "The Glass Harbor Cycle");
  await selectTree(page, "Project The Glass Harbor Cycle");
  await page.getByRole("button", { name: "Restore project" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible();
});

test("focused Draft prose autosaves and survives reopen and reload", async ({
  page
}) => {
  const prose =
    "The tide withdrew from the harbor, leaving every bell perfectly still.";

  await signIn(page);
  await createProject(page, "Durable Draft Harbor", "Book of Echoes");
  await addUnassignedScene(page, "Book of Echoes", "Opening Tide");
  await openDraftScene(page, "Scene Opening Tide");

  const editor = page.getByRole("textbox", { name: "Draft for Opening Tide" });
  const saveStatus = page.getByLabel("Draft save status");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  await editor.pressSequentially(prose);
  await expect(saveStatus).toHaveText("Waiting to save…");
  await expect(saveStatus).toHaveText("Saved to project", { timeout: 10_000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);

  await page.getByRole("button", { name: "← Projects" }).click();
  await openProject(page, "Durable Draft Harbor");
  await openDraftScene(page, "Scene Opening Tide");
  await expect(
    page.getByRole("textbox", { name: "Draft for Opening Tide" })
  ).toContainText(prose);

  await page.reload();
  await openProject(page, "Durable Draft Harbor");
  await openDraftScene(page, "Scene Opening Tide");
  await expect(
    page.getByRole("textbox", { name: "Draft for Opening Tide" })
  ).toContainText(prose);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible();
});

test("writer checkpoints, compares, restores, and reloads Draft history", async ({
  page
}) => {
  test.setTimeout(90_000);
  const checkpointProse = "The lantern crossed the black water.";
  const laterProse = " Then the harbor answered with three bells.";

  await signIn(page);
  await createProject(page, "History Harbor", "Book of Returning Tides");
  await addUnassignedScene(page, "Book of Returning Tides", "Lantern Crossing");
  await openDraftScene(page, "Scene Lantern Crossing");

  const editor = page.getByRole("textbox", {
    name: "Draft for Lantern Crossing"
  });
  const saveStatus = page.getByLabel("Draft save status");
  await editor.click();
  await editor.pressSequentially(checkpointProse);
  await expect(saveStatus).toHaveText("Saved to project", { timeout: 10_000 });

  await openDraftHistory(page);
  await page.getByRole("button", { name: "Create checkpoint" }).click();
  await expectAcknowledgement(page, "Checkpoint created");
  await dismissAcknowledgementToasts(page);
  await expect(
    page.getByRole("button", { name: /Select revision \d+:/ })
  ).toHaveCount(2);

  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(laterProse);
  await expect(saveStatus).toHaveText("Saved to project", { timeout: 10_000 });
  await page.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(
    page.getByRole("button", { name: /Select revision \d+:/ })
  ).toHaveCount(3);

  await page
    .getByRole("button", { name: "Select revision 2: Checkpoint" })
    .click();
  await page
    .getByRole("button", { name: "Compare with current checkpoint" })
    .click();
  await expect(page.getByLabel("Comparison summary")).toHaveText(
    "0 added · 0 removed · 1 changed · 0 moved"
  );
  const historyArea = page.getByLabel("Draft history");
  await expect(
    historyArea.getByText(checkpointProse, { exact: true })
  ).toBeVisible();
  await expect(
    historyArea.getByText(`${checkpointProse}${laterProse}`, { exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "Restore this revision" }).click();
  await expect(page.getByRole("button", { name: "Confirm restore" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm restore" }).click();
  await expect(editor).toContainText(checkpointProse);
  await expect(editor).not.toContainText(laterProse.trim());
  await expectAcknowledgement(page, "Draft revision restored");
  await dismissAcknowledgementToasts(page);
  await expect(
    page.getByRole("button", { name: /Select revision \d+:/ })
  ).toHaveCount(4);

  await page.reload();
  await openProject(page, "History Harbor");
  await openDraftScene(page, "Scene Lantern Crossing");
  await expect(
    page.getByRole("textbox", { name: "Draft for Lantern Crossing" })
  ).toContainText(checkpointProse);
  await openDraftHistory(page);
  await expect(page.getByText("Restored Draft").first()).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
});

test("writer explicitly recovers prose after an interrupted body save", async ({
  page
}) => {
  const localProse =
    "The storm erased the road, but Mara remembered every turning.";
  let abortNextBodySave = true;

  await signIn(page);
  await createProject(page, "Recovery Harbor", "Book of Lost Roads");
  await addUnassignedScene(page, "Book of Lost Roads", "The Remembered Road");
  await openDraftScene(page, "Scene The Remembered Road");

  await page.route("**/api/projects/**/scenes/**/body", async (route) => {
    if (route.request().method() === "PATCH" && abortNextBodySave) {
      abortNextBodySave = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  const editor = page.getByRole("textbox", {
    name: "Draft for The Remembered Road"
  });
  await editor.click();
  await editor.pressSequentially(localProse);
  await expect(page.getByLabel("Draft save status")).toHaveText("Not saved", {
    timeout: 10_000
  });

  await page.reload();
  await openProject(page, "Recovery Harbor");
  await openDraftScene(page, "Scene The Remembered Road");
  await expect(
    page.getByRole("button", { name: "Recover local Draft" })
  ).toBeVisible();
  await expect(
    page.getByText(/differs from the acknowledged project Draft/).first()
  ).toBeVisible();
  await page.getByRole("button", { name: "Recover local Draft" }).click();
  await expect(
    page.getByRole("textbox", { name: "Draft for The Remembered Road" })
  ).toContainText(localProse);
  await expect(page.getByLabel("Draft save status")).toHaveText(
    "Saved to project",
    { timeout: 10_000 }
  );

  await page.reload();
  await openProject(page, "Recovery Harbor");
  await openDraftScene(page, "Scene The Remembered Road");
  await expect(
    page.getByRole("textbox", { name: "Draft for The Remembered Road" })
  ).toContainText(localProse);
  await expect(
    page.getByRole("button", { name: "Recover local Draft" })
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
});

test("auth gate and project library remain usable on narrow web", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await expect(page.getByText(/Welcome, /)).toBeVisible();
  await expect(page.getByText("Continue your story")).toBeVisible();
  await expect(page.getByLabel("Project title")).toBeVisible();
  await createProject(page, "Narrow Harbor", "Small Tides");
  await openWorkspaceMode(page, "Canvas");
  await openCanvasSceneTool(page);
  await page.getByLabel("Canvas scene title").fill("Phone Draft");
  await page.getByRole("button", { name: "Small Tides · Unassigned" }).click();
  await page.getByRole("button", { name: "Create scene", exact: true }).click();
  // Narrow Map is outline-only — scene cards are not spatial objects here.
  await expect(
    page.getByRole("button", { name: /Canvas object 1: Phone Draft,/ })
  ).toBeVisible({ timeout: 15_000 });
  // Map-dense narrow uses the Project mode tab (not "Show manuscript tree").
  await page
    .getByLabel("Writing workspace modes")
    .getByRole("button", { name: "Project", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "Scene Phone Draft" })
  ).toBeVisible();
  await openWorkspaceMode(page, "Draft");
  await expect(page.getByLabel("Draft Desk")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Draft for Phone Draft" })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible();
});

test("writer storyboards on Canvas, writes in Split, undoes, and reloads both states", async ({
  page
}) => {
  test.setTimeout(120_000);
  const prose =
    "The lighthouse answered the storm with a beam that pointed inland.";

  await signIn(page);
  await createProject(page, "Canvas Harbor", "Book of Frames");
  await addStoryKnowledge(page, "Storm Omen");
  await selectTree(page, "Story knowledge Storm Omen");
  await page.getByRole("button", { name: "Confirmed" }).last().click();
  await openWorkspaceMode(page, "Canvas");

  await expect(page.getByLabel("Story Canvas workspace")).toBeVisible();
  await expect(page.getByLabel("Canvas save status")).toHaveText(
    "Saved to Canvas"
  );
  await openCanvasSceneTool(page);
  await page.getByLabel("Canvas scene title").fill("Lighthouse Turn");
  await page
    .getByRole("button", { name: "Book of Frames · Unassigned" })
    .click();
  await expect(page.getByLabel("Initial story order hint (0 = first)")).toHaveValue(
    "0"
  );
  await page.getByRole("button", { name: "Create scene", exact: true }).click();
  await expect(page.getByLabel(/Scene card Lighthouse Turn/)).toBeVisible({
    timeout: 15_000
  });

  await placeStoryKnowledgeOnCanvas(page, "Storm Omen");
  await expect(canvasStoryKnowledge(page, "Storm Omen")).toBeVisible();
  await showCanvasDetailsIfHidden(page);
  await expect(page.getByLabel("Selected object label")).toHaveValue("Storm Omen");
  await expect(page.getByText("Confirmed · writer-created").first()).toBeVisible();

  await createCanvasNote(page);
  await page.getByLabel(/^Writer note/).first().click();
  await showCanvasDetailsIfHidden(page);
  await expect(page.getByLabel("Selected object label")).toHaveValue(
    "Writer note",
    { timeout: 10_000 }
  );
  await page.getByLabel("Selected object label").fill("Storm signal");
  await page.getByRole("button", { name: "Save label" }).click();
  await expect(page.getByLabel("Canvas save status")).toHaveText("Saved to Canvas");
  await expect(page.getByLabel("Selected object label")).toHaveValue("Storm signal");
  await page
    .getByLabel("Note body")
    .fill("Track the signal across\nthree storm-dark windows.");
  await page.getByLabel("Note color").fill("#f4d7a1");
  await page.getByRole("button", { name: "Save note metadata" }).click();
  await expect(page.getByLabel("Canvas save status")).toHaveText("Saved to Canvas");
  await page.getByRole("button", { name: "Nudge right" }).click();
  await expect(page.getByLabel(/Writer note Storm signal/)).toBeVisible({
    timeout: 10_000
  });

  await createCanvasImageReference(page);
  await showCanvasDetailsIfHidden(page);
  await page
    .getByRole("textbox", { name: "Image alt text", exact: true })
    .fill("A lighthouse beam crossing storm clouds");
  await page
    .getByRole("textbox", { name: "Image caption", exact: true })
    .fill("Reference for the inland-pointing beam.");
  await page.getByLabel("Image asset ID (optional)").fill("asset-lighthouse-01");
  await page.getByLabel("Image MIME type (optional)").fill("image/png");
  await page.getByRole("button", { name: "Save image metadata" }).click();
  await expect(
    page.getByLabel("Image metadata Concept image reference")
  ).toBeVisible();

  await createCanvasRegion(page);
  await showCanvasDetailsIfHidden(page);
  await expect(page.getByLabel("Selected object label")).toHaveValue(
    "Story region"
  );
  await page.getByLabel("Selected object label").fill("Act I waters");
  await page.getByRole("button", { name: "Save label" }).click();
  await page.getByRole("button", { name: "Nudge down" }).click();
  await expect(page.getByLabel("Region Act I waters")).toBeVisible();

  await page
    .getByLabel("Story Canvas workspace")
    .getByRole("button", { name: "Outline view" })
    .click();
  await page
    .getByRole("button", { name: /Canvas object \d+: Storm signal,/ })
    .click();
  await page
    .getByLabel("Canvas inspector")
    .getByRole("button", { name: "Region · Act I waters", exact: true })
    .click();
  await page
    .getByLabel("Canvas inspector")
    .getByRole("button", { name: "Create confirmed thread link" })
    .click();
  await expect(page.getByText("thread · Act I waters")).toBeVisible();

  await expandReadingSpine(page);
  const spine = page.getByLabel("Reading-order spine");
  await expect(spine.getByText("Lighthouse Turn")).toBeVisible();
  await expect(spine.getByText("Aligned with Draft")).toBeVisible();

  await openWorkspaceMode(page, "Split");
  const editor = page.getByRole("textbox", {
    name: "Draft for Lighthouse Turn"
  });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  await editor.pressSequentially(prose);
  await expect(page.getByLabel("Draft save status")).toHaveText(
    "Saved to project",
    { timeout: 10_000 }
  );
  await page.getByRole("button", { name: "Undo Canvas command" }).click();
  await expectCanvasHistoryTitle(page, "Canvas action undone");
  await expect(editor).toContainText(prose);

  // Map-dense Split hides Selection inspector — archive story knowledge in Draft.
  await openWorkspaceMode(page, "Draft");
  const structureExpand = page.getByRole("button", {
    name: "Expand manuscript · ["
  });
  if (await structureExpand.first().isVisible().catch(() => false)) {
    await structureExpand.first().click();
  }
  await page.getByLabel("Search manuscript tree").fill("Storm Omen");
  await selectTree(page, "Story knowledge Storm Omen");
  await page.getByLabel("Search manuscript tree").fill("");
  await page
    .getByRole("button", { name: "Archive story knowledge" })
    .click();
  await page
    .getByRole("button", { name: "Confirm archive story knowledge" })
    .click();
  await openWorkspaceMode(page, "Canvas");
  await expect(
    page.getByText("Archived story record · stale reference").first()
  ).toBeVisible();

  await page.reload();
  await openProject(page, "Canvas Harbor");
  await openWorkspaceMode(page, "Canvas");
  await expect(page.getByLabel(/Writer note Storm signal/)).toBeVisible();
  await expect(page.getByLabel("Region Act I waters")).toBeVisible();
  await expect(page.getByLabel("Scene card Lighthouse Turn")).toBeVisible();
  await expect(canvasStoryKnowledge(page, "Storm Omen")).toBeVisible();
  await expect(
    page.getByText("Archived story record · stale reference").first()
  ).toBeVisible();
  await page
    .getByLabel("Story Canvas workspace")
    .getByRole("button", { name: "Outline view" })
    .click();
  await page
    .getByRole("button", { name: /Canvas object \d+: Storm signal,/ })
    .click();
  await showCanvasDetailsIfHidden(page);
  await expect(page.getByLabel("Note body")).toHaveValue(
    "Track the signal across\nthree storm-dark windows."
  );
  await expect(page.getByLabel("Note color")).toHaveValue("#f4d7a1");
  await page
    .getByRole("button", {
      name: /Canvas object \d+: Concept image reference,/
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Image alt text", exact: true })
  ).toHaveValue(
    "A lighthouse beam crossing storm clouds"
  );
  await expect(
    page.getByRole("textbox", { name: "Image caption", exact: true })
  ).toHaveValue(
    "Reference for the inland-pointing beam."
  );
  await expect(page.getByLabel("Image asset ID (optional)")).toHaveValue(
    "asset-lighthouse-01"
  );
  await expect(page.getByLabel("Image MIME type (optional)")).toHaveValue(
    "image/png"
  );
  await openWorkspaceMode(page, "Draft");
  const expandForDraft = page.getByRole("button", {
    name: "Expand manuscript · ["
  });
  if (await expandForDraft.first().isVisible().catch(() => false)) {
    await expandForDraft.first().click();
  }
  await page.getByLabel("Search manuscript tree").fill("Lighthouse Turn");
  await openDraftScene(page, "Scene Lighthouse Turn");
  await expect(
    page.getByRole("textbox", { name: "Draft for Lighthouse Turn" })
  ).toContainText(prose, { timeout: 10_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
});

test("narrow Canvas defaults to ordered keyboard review without freeform overflow", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await createProject(page, "Pocket Canvas", "Book of Small Turns");
  await openWorkspaceMode(page, "Canvas");

  await expect(page.getByLabel("Ordered Canvas outline")).toBeVisible();
  await expect(page.getByText("Ordered view")).toBeVisible();
  await expect(
    page.getByText("Every object, without spatial gestures")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Spatial", exact: true })
  ).toHaveCount(0);
  await expect(page.getByLabel("Spatial Story Canvas")).toHaveCount(0);

  await createCanvasNote(page);
  const outlineObject = page.getByRole("button", {
    name: /Canvas object 1: Writer note, Confirmed, Active,/
  });
  await outlineObject.focus();
  await outlineObject.press("Enter");
  await showCanvasDetailsIfHidden(page);
  const beforeLabel = (await outlineObject.getAttribute("aria-label")) ?? "";
  const beforePosition = beforeLabel.match(/x (-?\d+), y (-?\d+)/);
  const nudge = page.getByRole("button", { name: "Nudge right" });
  await nudge.focus();
  await nudge.press("Enter");
  await expect(async () => {
    const afterLabel =
      (await page
        .getByRole("button", { name: /Canvas object 1: Writer note/ })
        .first()
        .getAttribute("aria-label")) ?? "";
    const afterPosition = afterLabel.match(/x (-?\d+), y (-?\d+)/);
    expect(beforePosition).not.toBeNull();
    expect(afterPosition).not.toBeNull();
    expect(Number(afterPosition![1])).toBe(Number(beforePosition![1]) + 24);
    expect(afterPosition![2]).toBe(beforePosition![2]);
  }).toPass({ timeout: 10_000 });

  await page.getByRole("button", { name: "Sign out" }).click();
});

test("Canvas story-order hints show aligned and intentional drift without reordering Draft", async ({
  page
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await createProject(page, "Drift Harbor", "Book of Fixed Order");

  for (const title of ["Drift First", "Drift Second", "Drift Third"]) {
    await addUnassignedScene(page, "Book of Fixed Order", title);
  }
  await openDraftScene(page, "Scene Drift First");

  const manuscriptScenes = page.locator(
    '[aria-label="Scene Drift First"], [aria-label="Scene Drift Second"], [aria-label="Scene Drift Third"]'
  );
  const initialOrder = await manuscriptScenes.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label"))
  );
  expect(initialOrder).toEqual([
    "Scene Drift First",
    "Scene Drift Second",
    "Scene Drift Third"
  ]);

  await selectTree(page, "Scene Drift Second");
  await openWorkspaceMode(page, "Canvas");
  await placeSelectedDraftSceneOnCanvas(page);
  await showCanvasDetailsIfHidden(page);
  await expect(page.getByLabel("Current Canvas story order drift")).toContainText(
    "Draft position 2 · Aligned with Draft"
  );

  await page
    .getByRole("textbox", { name: "Story order hint (0 = first)", exact: true })
    .fill("0");
  await page.getByRole("button", { name: "Save story-order hint" }).click();
  await expect(page.getByLabel("Current Canvas story order drift")).toContainText(
    "Earlier on Canvas"
  );
  await expandReadingSpine(page);
  await expect(
    page.getByLabel("Reading-order spine").getByText("Earlier on Canvas")
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Story order hint (0 = first)", exact: true })
    .fill("2");
  await page.getByRole("button", { name: "Save story-order hint" }).click();
  await expect(page.getByLabel("Current Canvas story order drift")).toContainText(
    "Later on Canvas"
  );
  // Map-dense structure rail may be collapsed — expand before reading tree order.
  const structureExpand = page.getByRole("button", {
    name: "Expand manuscript · ["
  });
  if (await structureExpand.first().isVisible().catch(() => false)) {
    await structureExpand.first().click();
  }
  const treeSearch = page.getByLabel("Search manuscript tree");
  await expect(treeSearch).toBeVisible({ timeout: 10_000 });
  await treeSearch.fill("Drift");
  expect(
    await manuscriptScenes.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label"))
    )
  ).toEqual(initialOrder);
  await treeSearch.fill("");

  // Map-dense Canvas hides the manuscript Selection inspector — archive in Draft.
  await openWorkspaceMode(page, "Draft");
  await selectTree(page, "Scene Drift Second");
  await ensureSelectionInspectorVisible(page);
  await page.getByRole("button", { name: "Archive scene" }).click();
  await dismissAcknowledgementToasts(page);
  await page
    .getByRole("button", { name: "Confirm archive scene" })
    .click();
  await openWorkspaceMode(page, "Canvas");
  await expect(
    page.getByText("Archived scene · stale reference").first()
  ).toBeVisible();
  await expandReadingSpine(page);
  await expect(
    page
      .getByLabel("Reading-order spine")
      .getByText("Archived scene · stale Canvas reference")
  ).toBeVisible();
});

test("preferred Canvas scene restores the shared Draft selection after reload", async ({
  page
}) => {
  await signIn(page);
  await createProject(page, "Preference Harbor", "Book of Remembered Views");
  await addUnassignedScene(page, "Book of Remembered Views", "Preferred First");
  await addUnassignedScene(page, "Book of Remembered Views", "Preferred Second");
  await selectTree(page, "Scene Preferred Second");
  await openWorkspaceMode(page, "Canvas");
  await placeSelectedDraftSceneOnCanvas(page);

  const preferenceSaved = page.waitForResponse(
    (response) =>
      response.url().includes("/canvas/preference") &&
      response.request().method() === "PUT" &&
      response.ok()
  );
  await page.getByLabel("Scene card Preferred Second").click();
  await preferenceSaved;

  await page.reload();
  await openProject(page, "Preference Harbor");
  await openWorkspaceMode(page, "Canvas");
  await expect(page.getByLabel("Canvas save status")).toHaveText("Saved to Canvas");
  await showCanvasDetailsIfHidden(page);
  await expect(page.getByLabel("Selected object label")).toHaveValue(
    "Preferred Second",
    { timeout: 10_000 }
  );
  await openWorkspaceMode(page, "Draft");
  await expect(
    page.getByRole("textbox", { name: "Draft for Preferred Second" })
  ).toBeVisible();
});

test("pointer tree moves, Canvas drill, and workflow lenses preserve one scene", async ({
  page
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await createProject(page, "Workflow Harbor", "Book of Movements");
  await addPart(page, "Book of Movements", "Act One");
  await addChapter(page, "Act One", "Origin");
  await addChapter(page, "Act One", "Destination");
  await addSceneToChapter(page, "Origin", "Movable Signal");
  await dismissAcknowledgementToasts(page);

  const source = page.getByRole("treeitem", { name: "Scene Movable Signal" });
  const destination = page.getByRole("treeitem", { name: "Chapter Destination" });
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer });
  expect(
    await dataTransfer.evaluate((transfer) => transfer.getData("text/plain"))
  ).toContain("scene:");
  await destination.dispatchEvent("dragenter", { dataTransfer });
  await destination.dispatchEvent("dragover", { dataTransfer });
  await destination.dispatchEvent("drop", { dataTransfer });
  await source.dispatchEvent("dragend", { dataTransfer });
  await expectAcknowledgement(page, "Scene moved");
  await dismissAcknowledgementToasts(page);

  const treeSearch = page.getByLabel("Search manuscript tree");
  await treeSearch.fill("Movable Signal");
  await selectTree(page, "Scene Movable Signal");
  await treeSearch.fill("");
  await expect(
    page
      .getByLabel("Selection inspector")
      .getByText("Book of Movements · Destination · position 1 of 1", {
        exact: true
      })
  ).toBeVisible();

  await openWorkspaceMode(page, "Canvas");
  await placeSelectedDraftSceneOnCanvas(page);
  const sceneCard = page.getByLabel(/Scene card Movable Signal/);
  await expect(sceneCard).toBeVisible();
  await sceneCard.click();
  await showCanvasDetailsIfHidden(page);
  // Prefer keyboard nudge over pointer drag — RN web PanResponder is flaky in CI.
  await page.getByRole("button", { name: "Nudge right" }).click();
  // Map-dense success acknowledgements land in History, not toasts.
  await expectCanvasHistoryTitle(page, "Canvas object moved");

  // Prefer Chapter Aggregates over spatial overlays — scene cards intercept
  // pointer events on the freeform Enter-chapter hit targets.
  await page
    .getByRole("button", { name: "Enter chapter aggregate Destination" })
    .click();
  // Map-dense topbar trail labels (not the older CanvasDrillBar crumb copy).
  await expect(
    page.getByRole("button", {
      name: "Canvas scope, current Chapter · Destination"
    })
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: /Back to parent Canvas scope/ }).first()
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: /Canvas scope, current (Map|Workflow Harbor)/
    })
  ).toBeVisible({ timeout: 10_000 });

  const lenses = page.getByLabel("Canvas workflow lenses");
  // Outline lens hides the "· lens …" trail chip; assert named lenses only.
  for (const lens of ["Relationships", "Continuity", "Review"] as const) {
    await lenses.getByRole("button", { name: `${lens} lens`, exact: true }).click();
    await expect(
      page.getByText(
        new RegExp(`lens ${lens.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
      )
    ).toBeVisible();
    // Review lens auto-opens History; close it so later board clicks are free.
    if (lens === "Review") {
      await hideCanvasHistory(page);
    }
  }
  await lenses.getByRole("button", { name: "Outline lens", exact: true }).click();

  await lenses.getByRole("button", { name: "Plan → Draft lens", exact: true }).click();
  await expect(page.getByText(/lens Plan → Draft/)).toBeVisible();
  await hideCanvasHistory(page);
  await expect(page.getByLabel("Story Canvas workspace")).toBeVisible();
  await page
    .getByRole("button", { name: "Open Draft for Movable Signal" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Draft for Movable Signal" })
  ).toBeVisible({ timeout: 10_000 });
});

test("Reader keeps the selected Draft available when optional voice is unavailable", async ({
  page
}) => {
  const prose = "The reader heard the harbor answer in a borrowed voice.";

  await signIn(page);
  await createProject(page, "Reader Harbor", "Book of Spoken Tides");
  await addUnassignedScene(page, "Book of Spoken Tides", "Reader Opening");
  await addUnassignedScene(page, "Book of Spoken Tides", "Reader Return");
  await openDraftScene(page, "Scene Reader Opening");

  const editor = page.getByRole("textbox", { name: "Draft for Reader Opening" });
  await editor.click();
  await editor.pressSequentially(prose);
  await expect(page.getByLabel("Draft save status")).toHaveText(
    "Saved to project",
    { timeout: 10_000 }
  );

  await openWorkspaceMode(page, "Reader");
  await expect(page.getByText("Bound reader")).toBeVisible();
  await expect(page.getByText("Book of Spoken Tides")).toBeVisible();
  await expect(page.getByText(prose)).toBeVisible();
  await page.getByRole("button", { name: "Links", exact: true }).click();
  await expect(page.getByText("No Canvas links for this spread.")).toBeVisible();
  await page.getByRole("button", { name: "noir", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Reader voice is not configured on this server."
    })
  ).toBeVisible();
  await expect(page.getByText("Bound reader")).toBeVisible();

  await page.getByRole("button", { name: "Exit reader" }).click();
  await expect(
    page.getByRole("textbox", { name: "Draft for Reader Opening" })
  ).toContainText(prose);

  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspaceMode(page, "Reader");
  await expect(page.getByText("Reading Reader Opening")).toBeVisible();
  await expect(page.getByText("Scene 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Exit reader" }).click();
  await expect(
    page.getByRole("textbox", { name: "Draft for Reader Opening" })
  ).toContainText(prose);
});

test("workspace chat invokes the owner-scoped manuscript read capability", async ({
  page
}) => {
  await signIn(page);
  await createProject(page, "Chat Harbor", "Book of Tools");
  await page.getByRole("button", { name: "✦ Chat · ⌘⇧P" }).click();

  const chat = page.getByLabel("Command and chat palette");
  await expect(chat).toBeVisible();
  await chat
    .getByRole("button", {
      name: "Run Read a project's book and manuscript hierarchy"
    })
    .click();
  await expect(chat.getByText("project.navigator.read")).toBeVisible();
  await expect(
    chat.getByText("Ran Read a project's book and manuscript hierarchy.")
  ).toBeVisible();
  await expect(chat.getByText(/Chat Harbor · project version 1/)).toBeVisible();
  await expect(chat.getByText(/1 books · 0 scenes · 0 story records/)).toBeVisible();

  await chat.getByRole("button", { name: "Close palette" }).click();
  await expect(chat).toHaveCount(0);
});

test("two Canvas tabs reject a stale command and offer the latest board", async ({
  browser
}) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  const first = await context.newPage();
  await signIn(first);
  await createProject(first, "Canvas Conflict Harbor", "Book of Concurrent Boards");
  await openWorkspaceMode(first, "Canvas");
  await expect(first.getByLabel("Canvas save status")).toHaveText("Saved to Canvas");

  const second = await context.newPage();
  await second.goto("/");
  await openProject(second, "Canvas Conflict Harbor");
  await openWorkspaceMode(second, "Canvas");
  await expect(second.getByLabel("Canvas save status")).toHaveText("Saved to Canvas");

  const noteSaved = first.waitForResponse(
    (response) =>
      response.url().includes("/canvas/commands") &&
      response.request().method() === "POST" &&
      response.ok(),
    { timeout: 30_000 }
  );
  await createCanvasNote(first);
  await noteSaved;
  await expect(first.getByLabel(/Writer note Writer note/)).toBeVisible({
    timeout: 15_000
  });
  await expect(first.getByLabel("Canvas save status")).toHaveText("Saved to Canvas");

  // Arm + place without asserting creation — the stale command must fail.
  await ensureSpatialCanvasSurface(second);
  await activateCanvasTool(second, "Region", "R");
  await placeArmedCanvasToolOnSurface(second);
  // Conflicts land in History recent actions (not page toasts/banners).
  await showCanvasHistory(second);
  const history = second.getByLabel("Canvas history");
  await expect(
    history.getByText(
      "Story Canvas changed in another request. Ghostwriter applied nothing, reloaded the latest board, and kept the new version ready for review."
    )
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    history.getByRole("button", { name: "Reload Canvas" })
  ).toBeVisible();
  await hideCanvasHistory(second);
  await expect(second.getByLabel(/Writer note Writer note/)).toBeVisible({
    timeout: 15_000
  });
  await expect(second.getByLabel(/Region Story region/)).toHaveCount(0);

  await showCanvasHistory(second);
  await second
    .getByLabel("Canvas history")
    .getByRole("button", { name: "Reload Canvas" })
    .click();
  // Map-dense suppresses load toasts; the writer-visible outcome is the board itself.
  await expect(second.getByLabel(/Writer note Writer note/)).toBeVisible({
    timeout: 15_000
  });
  await expect(second.getByLabel("Canvas save status")).toHaveText(
    "Saved to Canvas"
  );
  await context.close();
});

test("writer selects and restores an earlier Canvas snapshot", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await createProject(page, "Snapshot Harbor", "Book of Earlier Shapes");
  await openWorkspaceMode(page, "Canvas");

  await createCanvasNote(page);
  await showCanvasDetailsIfHidden(page);
  await page.getByLabel("Selected object label").fill("Kept note", {
    timeout: 15_000
  });
  await page.getByRole("button", { name: "Save label" }).click();
  await createCanvasImageReference(page);
  await showCanvasDetailsIfHidden(page);
  await expect(
    page.getByLabel("Image metadata Concept image reference")
  ).toBeVisible();

  await showCanvasHistory(page);
  await expect(page.getByLabel("Canvas history")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Select Canvas snapshot 3: Object details updated"
    })
    .click({ timeout: 15_000 });
  await page
    .getByRole("button", { name: "Restore selected Canvas snapshot" })
    .click();
  await expect(page.getByText("Restore this Canvas snapshot?")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm Canvas restore" })
    .click();
  await expect(
    page.getByLabel("Canvas history").getByText("Canvas snapshot restored")
  ).toBeVisible({ timeout: 15_000 });
  await hideCanvasHistory(page);
  await expect(page.getByLabel(/Writer note Kept note/)).toBeVisible({
    timeout: 15_000
  });
  await expect(
    page.getByLabel("Image metadata Concept image reference")
  ).toHaveCount(0);
  // Provisional review-fixture chrome was removed from Map 3.0; restore outcome
  // is the writer-visible acceptance for this journey.
  await page
    .getByLabel("Story Canvas workspace")
    .getByRole("button", { name: "Outline view" })
    .click();
  await expect(
    page.getByRole("button", { name: /Canvas object 1: Kept note,/ })
  ).toBeVisible();
});

test("stale project writes reload the latest server state", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await signIn(first);
  await createProject(first, "Conflict Harbor", "Conflict Book");

  const second = await context.newPage();
  await second.goto("/");
  await openProject(second, "Conflict Harbor");

  await selectTree(first, "Project Conflict Harbor");
  await commitInspectorField(first, "Project title", "Fresh Harbor");
  await expect(first.getByText("Fresh Harbor").first()).toBeVisible();

  await selectTree(second, "Project Conflict Harbor");
  const staleTitle = second.getByLabel("Project title");
  await staleTitle.fill("Stale Harbor");
  await staleTitle.blur();
  await expect(
    second.getByText(
      "This project changed in another request. Ghostwriter reloaded the latest version; review and try again."
    )
  ).toBeVisible();
  await expect(second.getByText("Fresh Harbor").first()).toBeVisible();
  await context.close();
});

test("stale profile writes reload the latest account profile", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await signIn(first);

  const second = await context.newPage();
  await second.goto("/");
  await editPenName(first, "First Profile");
  await editPenName(second, "Stale Profile");

  await saveWriterProfile(first);
  await expect(first.getByText("Profile saved")).toBeVisible();
  await saveWriterProfile(second);
  await expect(
    second.getByText(
      "Your profile changed in another tab. Ghostwriter reloaded the latest name; review and save again."
    )
  ).toBeVisible();
  await second.getByRole("button", { name: "Close profile editor" }).click();
  await second.getByRole("button", { name: "Edit writer profile" }).click();
  await expect(second.getByLabel("Pen name")).toHaveValue("First Profile");
  await context.close();
});

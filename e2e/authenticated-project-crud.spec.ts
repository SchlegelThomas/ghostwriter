import { expect, test } from "@playwright/test";
import {
  addBook,
  addChapter,
  addPart,
  addSceneToChapter,
  addStoryKnowledge,
  addUnassignedScene,
  commitInspectorField,
  createProject,
  dismissAcknowledgementToasts,
  openDraftScene,
  openProject,
  openWorkspaceMode,
  selectTree,
  signIn
} from "./workspace-helpers.js";

test("writer signs in and manages a durable project hierarchy", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Welcome, E2E Writer")).toBeVisible();
  await expect(page.getByText("No projects yet")).toBeVisible();

  await page.getByLabel("Writer display name").fill("Test Novelist");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Welcome, Test Novelist")).toBeVisible();
  await expect(page.getByText("Profile saved")).toBeVisible();

  await createProject(page, "The Glass Harbor", "Book of Tides");
  await expect(page.getByText("Saved to project")).toBeVisible();

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
  await expect(page.getByText("Scene reordered").first()).toBeVisible();
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
  await selectTree(page, "Book Book of Tides");
  await selectTree(page, "Scene The Empty Pier");
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

  await page.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(page.getByText("Checkpoint created").first()).toBeVisible();
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
  await expect(page.getByText("Draft revision restored").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Select revision \d+:/ })
  ).toHaveCount(4);

  await page.reload();
  await openProject(page, "History Harbor");
  await openDraftScene(page, "Scene Lantern Crossing");
  await expect(
    page.getByRole("textbox", { name: "Draft for Lantern Crossing" })
  ).toContainText(checkpointProse);
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
  await page.getByRole("button", { name: "Storyboard a scene" }).click();
  await page.getByLabel("Canvas scene title").fill("Phone Draft");
  await page.getByRole("button", { name: "Small Tides · Unassigned" }).click();
  await page
    .getByRole("button", { name: "Create scene in Canvas and Draft" })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "Scene Phone Draft" })
  ).toBeVisible();
  await openWorkspaceMode(page, "Draft");
  await expect(page.getByText("Focused Draft").first()).toBeVisible();
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
  await page.getByRole("button", { name: "Storyboard a scene" }).click();
  await page.getByLabel("Canvas scene title").fill("Lighthouse Turn");
  await page
    .getByRole("button", { name: "Book of Frames · Unassigned" })
    .click();
  await expect(page.getByLabel("Initial story order hint (0 = first)")).toHaveValue(
    "0"
  );
  await expect(page.getByLabel("Initial Canvas x")).toHaveValue("160");
  await expect(page.getByLabel("Initial Canvas width")).toHaveValue("260");
  await page
    .getByRole("button", { name: "Create scene in Canvas and Draft" })
    .click();
  await expect(
    page.getByText("Scene created in Canvas and Draft").first()
  ).toBeVisible();
  await expect(page.getByLabel("Scene card Lighthouse Turn")).toBeVisible();

  await page
    .getByRole("button", { name: "Place Storm Omen on Canvas" })
    .click();
  await expect(page.getByLabel("Story knowledge Storm Omen")).toBeVisible();
  await expect(page.getByLabel("Selected object label")).toHaveValue("Storm Omen");
  await expect(page.getByText("Confirmed · writer-created").first()).toBeVisible();

  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByLabel("Selected object label")).toHaveValue(
    "Writer note"
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
  await expect(async () => {
    await expect(
      page.locator('[aria-label="Writer note Storm signal"]')
    ).toHaveCount(1);
  }).toPass({ timeout: 10_000 });

  await page.getByRole("button", { name: "Add image metadata" }).click();
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

  await page.getByRole("button", { name: "Create region" }).click();
  await expect(page.getByLabel("Selected object label")).toHaveValue(
    "Story region"
  );
  await page.getByLabel("Selected object label").fill("Act I waters");
  await page.getByRole("button", { name: "Save label" }).click();
  await page.getByRole("button", { name: "Nudge down" }).click();
  await expect(page.getByLabel("Region Act I waters")).toBeVisible();

  await page
    .getByRole("button", { name: "Add provisional beat fixture" })
    .click();
  await expect(
    page.getByText("Provisional fixture · not confirmed").first()
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review provisional A costly turn" })
    .click();
  await page.getByRole("button", { name: "Confirm object" }).click();
  await expect(
    page.getByText("Confirmed · writer-created").first()
  ).toBeVisible();

  await page
    .getByLabel("Story Canvas workspace")
    .getByRole("button", { name: "Outline", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Canvas object \d+: Storm signal,/ })
    .click();
  await page
    .getByRole("button", { name: "Region · Act I waters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create confirmed thread link" })
    .click();
  await expect(page.getByText("thread · Act I waters")).toBeVisible();

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
  await expect(page.getByText("Canvas action undone").first()).toBeVisible();
  await expect(editor).toContainText(prose);

  await selectTree(page, "Story knowledge Storm Omen");
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
  await expect(page.locator('[aria-label="Writer note Storm signal"]')).toHaveCount(1);
  await expect(page.getByLabel("Region Act I waters")).toBeVisible();
  await expect(page.getByLabel("Scene card Lighthouse Turn")).toBeVisible();
  await expect(page.getByLabel("Story knowledge Storm Omen")).toBeVisible();
  await expect(
    page.getByText("Archived story record · stale reference").first()
  ).toBeVisible();
  await page
    .getByLabel("Story Canvas workspace")
    .getByRole("button", { name: "Outline", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Canvas object \d+: Storm signal,/ })
    .click();
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
  await expect(
    page.getByRole("textbox", { name: "Draft for Lighthouse Turn" })
  ).toContainText(prose);
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
  await expect(
    page.getByText("Ordered review mode · freeform drag stays on wide web")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Spatial", exact: true })
  ).toHaveCount(0);
  await expect(page.getByLabel("Spatial Story Canvas")).toHaveCount(0);

  await page.getByRole("button", { name: "Create note" }).click();
  const outlineObject = page.getByRole("button", {
    name: /Canvas object 1: Writer note/
  });
  await outlineObject.focus();
  await outlineObject.press("Enter");
  const nudge = page.getByRole("button", { name: "Nudge right" });
  await nudge.focus();
  await nudge.press("Enter");
  await expect(
    page.getByRole("button", { name: /Canvas object 1: Writer note.*x 72, y 52/ })
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
});

test("Canvas story-order hints show aligned and intentional drift without reordering Draft", async ({
  page
}) => {
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
  await page
    .getByRole("button", { name: "Place selected Draft scene" })
    .click();
  await expect(page.getByLabel("Current Canvas story order drift")).toContainText(
    "Draft position 2 · Aligned with Draft"
  );

  await page.getByLabel("Story order hint (0 = first)").fill("0");
  await page.getByRole("button", { name: "Save story-order hint" }).click();
  await expect(page.getByLabel("Current Canvas story order drift")).toContainText(
    "Earlier on Canvas"
  );
  await expect(
    page.getByLabel("Reading-order spine").getByText("Earlier on Canvas")
  ).toBeVisible();

  await page.getByLabel("Story order hint (0 = first)").fill("2");
  await page.getByRole("button", { name: "Save story-order hint" }).click();
  await expect(page.getByLabel("Current Canvas story order drift")).toContainText(
    "Later on Canvas"
  );
  expect(
    await manuscriptScenes.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label"))
    )
  ).toEqual(initialOrder);

  await selectTree(page, "Scene Drift Second");
  await page.getByRole("button", { name: "Archive scene" }).click();
  await dismissAcknowledgementToasts(page);
  await page
    .getByRole("button", { name: "Confirm archive scene" })
    .click();
  await openWorkspaceMode(page, "Canvas");
  await expect(
    page.getByText("Archived scene · stale reference").first()
  ).toBeVisible();
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
  await page
    .getByRole("button", { name: "Place selected Draft scene" })
    .click();

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
  const showInspector = page.getByRole("button", { name: "Show inspector" });
  if (await showInspector.isVisible()) {
    await showInspector.click();
  }
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
  await expect(page.getByText("Scene moved").first()).toBeVisible();

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
  await page.getByRole("button", { name: "Place selected Draft scene" }).click();
  const sceneCard = page.getByLabel("Scene card Movable Signal");
  await expect(sceneCard).toBeVisible();

  const frame = await sceneCard.boundingBox();
  expect(frame).not.toBeNull();
  await page.mouse.move(frame!.x + frame!.width / 2, frame!.y + frame!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    frame!.x + frame!.width / 2 + 42,
    frame!.y + frame!.height / 2 + 24,
    { steps: 6 }
  );
  await page.mouse.up();
  await expect(page.getByText("Canvas object moved").first()).toBeVisible();

  await page.getByRole("button", { name: "Enter chapter Destination" }).click();
  await expect(
    page.getByRole("button", {
      name: "Canvas scope Destination, current scope"
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to parent Canvas scope" })
  ).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Canvas scope Workflow Harbor, current scope"
    })
  ).toBeVisible();

  const lenses = page.getByLabel("Canvas workflow lenses");
  for (const lens of ["Relationships", "Continuity", "Review", "Outline"] as const) {
    const button = lenses.getByRole("button", { name: lens, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-selected", "true");
  }

  await lenses.getByRole("button", { name: "Plan → Draft" }).click();
  await expect(page.getByLabel("Story Canvas workspace")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Draft for Movable Signal" })
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Chat", exact: true }).click();

  const chat = page.getByLabel("Workspace MCP chat");
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

  await chat.getByRole("button", { name: "Close" }).click();
  await expect(chat).toHaveCount(0);
});

test("two Canvas tabs reject a stale command and offer the latest board", async ({
  browser
}) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await signIn(first);
  await createProject(first, "Canvas Conflict Harbor", "Book of Concurrent Boards");
  await openWorkspaceMode(first, "Canvas");
  await expect(first.getByText(/version 1/)).toBeVisible();

  const second = await context.newPage();
  await second.goto("/");
  await openProject(second, "Canvas Conflict Harbor");
  await openWorkspaceMode(second, "Canvas");
  await expect(second.getByText(/version 1/)).toBeVisible();

  await first.getByRole("button", { name: "Create note" }).click();
  await expect(first.getByLabel("Writer note Writer note")).toBeVisible();

  await second.getByRole("button", { name: "Create region" }).click();
  await expect(
    second.getByText(
      "Story Canvas changed in another request. Ghostwriter applied nothing, reloaded the latest board, and kept the new version ready for review."
    ).first()
  ).toBeVisible();
  await expect(
    second.getByRole("button", { name: "Reload latest Canvas" })
  ).toBeVisible();
  await expect(second.getByLabel("Writer note Writer note")).toBeVisible();
  await expect(second.getByLabel("Region Story region")).toHaveCount(0);

  await second.getByRole("button", { name: "Reload latest Canvas" }).click();
  await expect(
    second.getByText(
      "Latest server-acknowledged Canvas loaded for review."
    )
  ).toBeVisible();
  await expect(second.getByLabel("Writer note Writer note")).toBeVisible();
  await context.close();
});

test("writer selects and restores an earlier Canvas snapshot", async ({ page }) => {
  await signIn(page);
  await createProject(page, "Snapshot Harbor", "Book of Earlier Shapes");
  await openWorkspaceMode(page, "Canvas");

  await page.getByRole("button", { name: "Create note" }).click();
  await page.getByLabel("Selected object label").fill("Kept note");
  await page.getByRole("button", { name: "Save label" }).click();
  await page.getByRole("button", { name: "Add image metadata" }).click();
  await expect(
    page.getByLabel("Image metadata Concept image reference")
  ).toBeVisible();

  await page.getByRole("button", { name: "Show Canvas history" }).click();
  await expect(page.getByLabel("Canvas history")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Select Canvas snapshot 3: Object details updated"
    })
    .click();
  await page
    .getByRole("button", { name: "Restore selected Canvas snapshot" })
    .click();
  await expect(page.getByText("Restore this Canvas snapshot?")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm Canvas restore" })
    .click();
  await expect(page.getByText("Canvas snapshot restored").first()).toBeVisible();
  await expect(page.getByLabel("Writer note Kept note")).toBeVisible();
  await expect(
    page.getByLabel("Image metadata Concept image reference")
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Hide Canvas history" }).click();
  await page
    .getByRole("button", { name: "Add provisional beat fixture" })
    .click();
  await page
    .getByRole("button", { name: "Dismiss provisional A costly turn" })
    .click();
  await expect(page.getByLabel("Writer note A costly turn")).toHaveCount(0);
  await page
    .getByLabel("Story Canvas workspace")
    .getByRole("button", { name: "Outline", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: /Canvas object 2: A costly turn, Provisional fixture, Dismissed/
    })
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
  await first.getByLabel("Writer display name").fill("First Profile");
  await second.getByLabel("Writer display name").fill("Stale Profile");

  await first.getByRole("button", { name: "Save profile" }).click();
  await expect(first.getByText("Profile saved")).toBeVisible();
  await second.getByRole("button", { name: "Save profile" }).click();
  await expect(
    second.getByText(
      "Your profile changed in another tab. Ghostwriter reloaded the latest name; review and save again."
    )
  ).toBeVisible();
  await expect(second.getByLabel("Writer display name")).toHaveValue("First Profile");
  await context.close();
});

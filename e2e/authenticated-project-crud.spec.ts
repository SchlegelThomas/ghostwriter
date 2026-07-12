import { expect, test } from "@playwright/test";

test("writer signs in and manages a durable project hierarchy", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByText("Welcome, E2E Writer")).toBeVisible();
  await expect(page.getByText("No projects yet")).toBeVisible();

  await page.getByLabel("Writer display name").fill("Test Novelist");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Welcome, Test Novelist")).toBeVisible();
  await expect(page.getByText("Profile saved")).toBeVisible();

  await page.getByLabel("Project title").fill("The Glass Harbor");
  await page.getByLabel("First book title").fill("Book of Tides");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByText("The Glass Harbor").first()).toBeVisible();
  await expect(page.getByText("Saved to project")).toBeVisible();

  await page.getByLabel("Project title").fill("The Glass Harbor Cycle");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(page.getByText("The Glass Harbor Cycle").first()).toBeVisible();

  await page.getByLabel("New book title").fill("Book of Storms");
  await page.getByRole("button", { name: "Add book" }).click();
  await expect(page.getByText("Book of Storms").first()).toBeVisible();
  await page.getByLabel("Book Book of Storms").click();
  await page.getByLabel("Selected book title").fill("Book of Storms Revised");
  await page.getByRole("button", { name: "drafting" }).first().click();
  await page.getByRole("button", { name: "Save book" }).click();
  await page.getByRole("button", { name: "Move up" }).click();
  await page.getByRole("button", { name: "Archive book" }).click();
  await page.getByRole("button", { name: "Confirm archive book" }).click();
  await page.getByRole("button", { name: "Restore book" }).click();
  await page.getByLabel("Book Book of Tides").click();

  await page.getByLabel("New part title").fill("Part One");
  await page.getByRole("button", { name: "Add part" }).click();
  await page.getByLabel("New part title").fill("Empty Part");
  await page.getByRole("button", { name: "Add part" }).click();
  await page.getByLabel("Part Empty Part").click();
  await page.getByLabel("Selected part title").fill("Temporary Part");
  await page.getByRole("button", { name: "Save part" }).click();
  await page.getByRole("button", { name: "Part ↑" }).click();
  await page.getByRole("button", { name: "Remove empty part" }).click();
  await page.getByRole("button", { name: "Confirm remove part" }).click();
  await page.getByLabel("Part Part One").click();
  await page.getByLabel("New chapter title").fill("Low Water");
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByLabel("New chapter title").fill("Empty Chapter");
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByLabel("Chapter Empty Chapter").click();
  await page.getByLabel("Selected chapter title").fill("Temporary Chapter");
  await page.getByRole("button", { name: "Save chapter" }).click();
  await page.getByRole("button", { name: "Chapter ↑" }).click();
  await page.getByRole("button", { name: "Remove empty chapter" }).click();
  await page.getByRole("button", { name: "Confirm remove chapter" }).click();
  await page.getByLabel("Chapter Low Water").click();
  await page.getByLabel("New scene title").fill("The Empty Pier");
  await page.getByRole("button", { name: "Add to chapter" }).click();
  await page.getByLabel("New scene title").fill("The Bell Below");
  await page.getByRole("button", { name: "Add to chapter" }).click();
  await page.getByLabel("Scene The Bell Below").click();
  await page.getByRole("button", { name: "Scene ↑" }).click();
  await expect(page.getByText("The Empty Pier").first()).toBeVisible();
  const sceneOrder = await page
    .locator(
      '[aria-label="Scene The Bell Below"], [aria-label="Scene The Empty Pier"]'
    )
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  expect(sceneOrder.slice(0, 2)).toEqual([
    "Scene The Bell Below",
    "Scene The Empty Pier"
  ]);
  await page.getByLabel("New chapter title").fill("High Water");
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page
    .getByRole("button", { name: "Book of Tides · High Water" })
    .click();
  await page.getByLabel("Scene The Empty Pier").click();

  await page
    .getByLabel("New story-knowledge label")
    .fill("Mara Venn");
  await page.getByRole("button", { name: "Add story knowledge" }).click();
  await expect(page.getByText("Mara Venn").first()).toBeVisible();

  await page.getByLabel("Scene summary").fill("Mara finds the harbor abandoned.");
  await page.getByRole("button", { name: "Mara Venn" }).last().click();
  await page.getByRole("button", { name: "Save scene" }).click();
  await page
    .getByRole("button", { name: "Link The Empty Pier" })
    .click();
  await expect(page.getByText(/1 scene links/)).toBeVisible();

  await page.getByRole("button", { name: "Archive scene" }).click();
  await page.getByRole("button", { name: "Confirm archive scene" }).click();
  await expect(page.getByRole("button", { name: "Restore scene" })).toBeVisible();
  await page.getByRole("button", { name: "Restore scene" }).click();

  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Save scene" }).click();
  await page
    .getByRole("button", { name: "Unlink The Empty Pier" })
    .click();
  await page.getByRole("button", { name: "confirmed" }).last().click();
  await page.getByRole("button", { name: "Save story knowledge" }).click();
  await page.getByRole("button", { name: "Archive story knowledge" }).click();
  await page
    .getByRole("button", { name: "Confirm archive story knowledge" })
    .click();
  await page.getByRole("button", { name: "Restore story knowledge" }).click();

  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByText("The Glass Harbor Cycle")).toBeVisible();
  await page.getByText("The Glass Harbor Cycle").click();
  await page.getByRole("button", { name: "Project setup" }).click();
  await page.getByLabel("Book Book of Tides").click();
  await page.getByLabel("Scene The Empty Pier").click();
  await expect(page.getByLabel("Scene summary")).toHaveValue(
    "Mara finds the harbor abandoned."
  );

  await page.getByRole("button", { name: "Archive project" }).click();
  await page.getByRole("button", { name: "Confirm archive project" }).click();
  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.getByRole("button", { name: "Show archived" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
  await page.getByText("The Glass Harbor Cycle").click();
  await page.getByRole("button", { name: "Project setup" }).click();
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

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Project title").fill("Durable Draft Harbor");
  await page.getByLabel("First book title").fill("Book of Echoes");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("New scene title").fill("Opening Tide");
  await page.getByRole("button", { name: "Add unassigned" }).click();
  await page.getByLabel("Scene Opening Tide").click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();

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

  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByLabel("Project Durable Draft Harbor").click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Draft for Opening Tide" })
  ).toContainText(prose);

  await page.reload();
  await page.getByLabel("Project Durable Draft Harbor").click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
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

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Project title").fill("History Harbor");
  await page.getByLabel("First book title").fill("Book of Returning Tides");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("New scene title").fill("Lantern Crossing");
  await page.getByRole("button", { name: "Add unassigned" }).click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();

  const editor = page.getByRole("textbox", {
    name: "Draft for Lantern Crossing"
  });
  const saveStatus = page.getByLabel("Draft save status");
  await editor.click();
  await editor.pressSequentially(checkpointProse);
  await expect(saveStatus).toHaveText("Saved to project", { timeout: 10_000 });

  await page.getByRole("button", { name: "Create checkpoint" }).click();
  await expect(
    page.getByText("Checkpoint created from the latest acknowledged Draft.")
  ).toBeVisible();
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
  await expect(
    page.getByText(
      "Revision restored as a new checkpoint. Earlier History remains unchanged."
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Select revision \d+:/ })
  ).toHaveCount(4);

  await page.reload();
  await page.getByLabel("Project History Harbor").click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
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

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Project title").fill("Recovery Harbor");
  await page.getByLabel("First book title").fill("Book of Lost Roads");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("New scene title").fill("The Remembered Road");
  await page.getByRole("button", { name: "Add unassigned" }).click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();

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
  await page.getByLabel("Project Recovery Harbor").click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recover local Draft" })
  ).toBeVisible();
  await expect(
    page.getByText(/differs from the acknowledged project Draft/)
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
  await page.getByLabel("Project Recovery Harbor").click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
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
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByText(/Welcome, /)).toBeVisible();
  await expect(page.getByText("Continue your story")).toBeVisible();
  await expect(page.getByLabel("Project title")).toBeVisible();
  await page.getByLabel("Project title").fill("Narrow Harbor");
  await page.getByLabel("First book title").fill("Small Tides");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Project title").fill("Narrow Harbor Revised");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(page.getByText("Narrow Harbor Revised").first()).toBeVisible();
  await page.getByLabel("New scene title").fill("Phone Draft");
  await page.getByRole("button", { name: "Add unassigned" }).click();
  await expect(page.getByLabel("Scene Phone Draft")).toBeVisible();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(page.getByText("Focused Draft")).toBeVisible();
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

  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Project title").fill("Canvas Harbor");
  await page.getByLabel("First book title").fill("Book of Frames");
  await page.getByRole("button", { name: "Create project" }).click();
  await page
    .getByLabel("New story-knowledge label")
    .fill("Storm Omen");
  await page.getByRole("button", { name: "confirmed" }).last().click();
  await page.getByRole("button", { name: "Add story knowledge" }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();

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
    page.getByText(
      "Scene “Lighthouse Turn” was created once, placed on Canvas, and added to Draft."
    )
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
  await page
    .getByLabel("Note body")
    .fill("Track the signal across\nthree storm-dark windows.");
  await page.getByLabel("Note color").fill("#f4d7a1");
  await page.getByRole("button", { name: "Save note metadata" }).click();
  await page.getByRole("button", { name: "Nudge right" }).click();
  await expect(page.getByLabel("Writer note Storm signal")).toBeVisible();

  await page.getByRole("button", { name: "Add image metadata" }).click();
  await page
    .getByLabel("Image alt text")
    .fill("A lighthouse beam crossing storm clouds");
  await page
    .getByLabel("Image caption")
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

  await page.getByLabel("Writer note Storm signal").click();
  await page.getByRole("button", { name: "Act I waters", exact: true }).click();
  await page
    .getByRole("button", { name: "Create confirmed thread link" })
    .click();
  await expect(page.getByText("thread · Act I waters")).toBeVisible();

  const spine = page.getByLabel("Reading-order spine");
  await expect(spine.getByText("Lighthouse Turn")).toBeVisible();
  await expect(spine.getByText("Aligned with Draft")).toBeVisible();

  await page.getByRole("button", { name: "Split", exact: true }).click();
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
  await expect(
    page.getByText(
      "The latest Canvas command was undone. Draft prose and manuscript order were unchanged."
    )
  ).toBeVisible();
  await expect(editor).toContainText(prose);

  await page.getByRole("button", { name: "Project setup" }).click();
  await page
    .getByRole("button", { name: "Archive story knowledge" })
    .click();
  await page
    .getByRole("button", { name: "Confirm archive story knowledge" })
    .click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(
    page.getByText("Archived story record · stale reference").first()
  ).toBeVisible();

  await page.reload();
  await page.getByLabel("Project Canvas Harbor").click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.getByLabel("Writer note Storm signal")).toBeVisible();
  await expect(page.getByLabel("Region Act I waters")).toBeVisible();
  await expect(page.getByLabel("Scene card Lighthouse Turn")).toBeVisible();
  await expect(page.getByLabel("Story knowledge Storm Omen")).toBeVisible();
  await expect(
    page.getByText("Archived story record · stale reference").first()
  ).toBeVisible();
  await page.getByLabel("Writer note Storm signal").click();
  await expect(page.getByLabel("Note body")).toHaveValue(
    "Track the signal across\nthree storm-dark windows."
  );
  await expect(page.getByLabel("Note color")).toHaveValue("#f4d7a1");
  await page.getByLabel("Image metadata Concept image reference").click();
  await expect(page.getByLabel("Image alt text")).toHaveValue(
    "A lighthouse beam crossing storm clouds"
  );
  await expect(page.getByLabel("Image caption")).toHaveValue(
    "Reference for the inland-pointing beam."
  );
  await expect(page.getByLabel("Image asset ID (optional)")).toHaveValue(
    "asset-lighthouse-01"
  );
  await expect(page.getByLabel("Image MIME type (optional)")).toHaveValue(
    "image/png"
  );
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Draft for Lighthouse Turn" })
  ).toContainText(prose);
  await page.getByRole("button", { name: "Sign out" }).click();
});

test("narrow Canvas defaults to ordered keyboard review without freeform overflow", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Project title").fill("Pocket Canvas");
  await page.getByLabel("First book title").fill("Book of Small Turns");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();

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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);

  await page.getByRole("button", { name: "Sign out" }).click();
});

test("Canvas story-order hints show aligned and intentional drift without reordering Draft", async ({
  page
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Project title").fill("Drift Harbor");
  await page.getByLabel("First book title").fill("Book of Fixed Order");
  await page.getByRole("button", { name: "Create project" }).click();

  for (const title of ["Drift First", "Drift Second", "Drift Third"]) {
    await page.getByLabel("New scene title").fill(title);
    await page.getByRole("button", { name: "Add unassigned" }).click();
  }
  await page.getByRole("button", { name: "Draft", exact: true }).click();

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

  await page.getByLabel("Scene Drift Second").click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
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

  await page.getByRole("button", { name: "Project setup" }).click();
  await page.getByRole("button", { name: "Archive scene" }).click();
  await page
    .getByRole("button", { name: "Confirm archive scene" })
    .click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
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
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Project title").fill("Preference Harbor");
  await page.getByLabel("First book title").fill("Book of Remembered Views");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("New scene title").fill("Preferred First");
  await page.getByRole("button", { name: "Add unassigned" }).click();
  await page.getByLabel("New scene title").fill("Preferred Second");
  await page.getByRole("button", { name: "Add unassigned" }).click();
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await page.getByLabel("Scene Preferred Second").click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
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
  await page.getByLabel("Project Preference Harbor").click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.getByLabel("Selected object label")).toHaveValue(
    "Preferred Second"
  );
  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Draft for Preferred Second" })
  ).toBeVisible();
});

test("two Canvas tabs reject a stale command and offer the latest board", async ({
  browser
}) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto("/");
  await first.getByRole("button", { name: "Continue with Google" }).click();
  await first.getByLabel("Project title").fill("Canvas Conflict Harbor");
  await first.getByLabel("First book title").fill("Book of Concurrent Boards");
  await first.getByRole("button", { name: "Create project" }).click();
  await first.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(first.getByText(/version 1/)).toBeVisible();

  const second = await context.newPage();
  await second.goto("/");
  await second.getByLabel("Project Canvas Conflict Harbor").click();
  await second.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(second.getByText(/version 1/)).toBeVisible();

  await first.getByRole("button", { name: "Create note" }).click();
  await expect(first.getByLabel("Writer note Writer note")).toBeVisible();

  await second.getByRole("button", { name: "Create region" }).click();
  await expect(
    second.getByText(
      "Story Canvas changed in another request. Ghostwriter applied nothing, reloaded the latest board, and kept the new version ready for review."
    )
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
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Project title").fill("Snapshot Harbor");
  await page.getByLabel("First book title").fill("Book of Earlier Shapes");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();

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
  await expect(
    page.getByText(
      "The selected Canvas snapshot was restored as a new current board. Draft prose and manuscript order were unchanged."
    )
  ).toBeVisible();
  await expect(page.getByLabel("Writer note Kept note")).toBeVisible();
  await expect(
    page.getByLabel("Image metadata Concept image reference")
  ).toHaveCount(0);
  await expect(page.getByText(/1 objects · 0 links · version 5/)).toBeVisible();

  await page.getByRole("button", { name: "Hide Canvas history" }).click();
  await page
    .getByRole("button", { name: "Add provisional beat fixture" })
    .click();
  await page
    .getByRole("button", { name: "Dismiss provisional A costly turn" })
    .click();
  await expect(page.getByLabel("Writer note A costly turn")).toHaveCount(0);
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /Canvas object 2: A costly turn, Provisional fixture, Dismissed/
    })
  ).toBeVisible();
});

test("stale project writes reload the latest server state", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto("/");
  await first.getByRole("button", { name: "Continue with Google" }).click();
  await first.getByLabel("Project title").fill("Conflict Harbor");
  await first.getByLabel("First book title").fill("Conflict Book");
  await first.getByRole("button", { name: "Create project" }).click();

  const second = await context.newPage();
  await second.goto("/");
  await second.getByLabel("Project Conflict Harbor").click();

  await first.getByLabel("Project title").fill("Fresh Harbor");
  await first.getByRole("button", { name: "Save title" }).click();
  await expect(first.getByText("Fresh Harbor").first()).toBeVisible();

  await second.getByLabel("Project title").fill("Stale Harbor");
  await second.getByRole("button", { name: "Save title" }).click();
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
  await first.goto("/");
  await first.getByRole("button", { name: "Continue with Google" }).click();

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

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

  await page.getByLabel("New part title").fill("Part One");
  await page.getByRole("button", { name: "Add part" }).click();
  await page.getByLabel("New chapter title").fill("Low Water");
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByLabel("New scene title").fill("The Empty Pier");
  await page.getByRole("button", { name: "Add to chapter" }).click();
  await expect(page.getByText("The Empty Pier").first()).toBeVisible();

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
  await expect(page.getByRole("button", { name: "Restore scene" })).toBeVisible();
  await page.getByRole("button", { name: "Restore scene" }).click();

  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByText("The Glass Harbor Cycle")).toBeVisible();
  await page.getByText("The Glass Harbor Cycle").click();
  await expect(page.getByText("Mara finds the harbor abandoned.")).toBeVisible();

  await page.getByRole("button", { name: "Archive project" }).click();
  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.getByRole("button", { name: "Show archived" }).click();
  await expect(page.getByText("Archived")).toBeVisible();
  await page.getByText("The Glass Harbor Cycle").click();
  await page.getByRole("button", { name: "Restore project" }).click();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google" })
  ).toBeVisible();
});

test("auth gate and project library remain usable on narrow web", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByText(/Welcome, /)).toBeVisible();
  await expect(page.getByText("Continue your story")).toBeVisible();
  await expect(page.getByLabel("Project title")).toBeVisible();
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

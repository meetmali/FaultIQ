import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { ANALYSIS_ID, EQUIPMENT_ID, event, faultTitle, mockApi } from "./fixtures";

async function persona(page: Page, who: "operator" | "technician", theme: "light" | "dark" = "light") {
  await page.addInitScript(
    ([p, t]) => {
      window.localStorage.setItem("faultiq.persona", p);
      window.localStorage.setItem("faultiq.theme", t);
    },
    [who, theme],
  );
}

async function noA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
}

async function noPlaceholders(page: Page) {
  await expect(page.getByText(/undefined|NaN|\[object Object\]/)).toHaveCount(0);
}

// The exit journeys: overview -> a specific diagnosis -> the fault reference -> back, for both
// personas, without broken navigation or unexplained placeholder values (ADR 0025, 0026).

test("operator: home to a unit's plain summary, then into the technician view of the same case", async ({ page }) => {
  await persona(page, "operator");
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "How are your rooftop units?" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Operator" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("link", { name: /RTU-1/ }).first().click();
  await expect(page.getByRole("heading", { name: "Dirty outdoor coil" })).toBeVisible();
  await expect(page.getByText("What to do")).toBeVisible();
  await expect(page.getByRole("img", { name: /Problem area: Outdoor \(condenser\) coil/ })).toBeVisible();
  await noPlaceholders(page);
  await noA11yViolations(page);

  await page.getByRole("button", { name: "Open technician view" }).click();
  await expect(page.getByRole("heading", { name: "Diagnostic workbench: RTU-1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fault signature check" })).toBeVisible();
});

test("technician: work queue to the workbench, the fault library and back", async ({ page }) => {
  await persona(page, "technician", "dark");
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Work queue" })).toBeVisible();
  await noA11yViolations(page);

  await page.getByRole("link", { name: faultTitle }).first().click();
  await expect(page.getByRole("heading", { name: "Diagnostic workbench: RTU-1" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Rooftop unit schematic at/ })).toBeVisible();
  await expect(page.getByText(/1 of 1 signals support it/).first()).toBeVisible();
  const detail = page.getByRole("region", { name: faultTitle });
  await expect(detail.getByText("Model inference", { exact: true })).toBeVisible();
  await expect(detail.getByText(event.statements[0].text)).toBeVisible();
  await noPlaceholders(page);
  await noA11yViolations(page);

  await detail.getByRole("link", { name: /in the Fault Library/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: faultTitle })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where it shows on the unit" })).toBeVisible();
  await noA11yViolations(page);
  await page.getByRole("link", { name: "Back to the diagnosis" }).click();
  await expect(page).toHaveURL(new RegExp(`event=${event.id}`));
});

test("technician: the data-quality report and the model behind a result (ADR 0027)", async ({ page }) => {
  await persona(page, "technician", "light");
  await mockApi(page);
  await page.goto(`/equipment/${EQUIPMENT_ID}?analysis=${ANALYSIS_ID}`);
  const quality = page.getByRole("region", { name: "Data quality" });
  await expect(quality.getByText("Accepted with warnings")).toBeVisible();
  await expect(quality.getByText(/Missing minutes are flagged, not filled/)).toBeVisible();
  await noA11yViolations(page);

  await page.getByRole("link", { name: "lbnl_simulated-all@diagnosis-0.1.0+fixture" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Models" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All points" }).first()).toBeVisible();
  await expect(page.getByText("lbnl_simulated-all@diagnosis-0.1.0+fixture")).toBeVisible();
  await noPlaceholders(page);
  await noA11yViolations(page);
});

test("the equipment switcher announces types that aren't supported yet", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Equipment type/ }).click();
  await page.getByRole("menuitem", { name: /Air handling units/ }).click();
  await expect(page.getByRole("dialog")).toContainText("available in a future release");
});

test("the library is searchable by symptom in both personas", async ({ page }) => {
  await persona(page, "operator", "dark");
  await mockApi(page);
  await page.goto("/library");
  await page.getByLabel("Search by fault or symptom").fill("discharge");
  await expect(page.getByRole("link", { name: /Dirty outdoor coil/ })).toBeVisible();
  await noA11yViolations(page);
});

test("keyboard users can skip to content", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("errors offer a retry, and demo mode labels sample data and hides uploads", async ({ page }) => {
  await persona(page, "technician");
  await mockApi(page, { failOverview: true });
  await page.goto("/");
  await expect(page.getByRole("alert").first()).toContainText("An unexpected error occurred.");
  await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockApi(page, { demo: true });
  await page.goto("/");
  await expect(page.getByRole("note", { name: "Public demo notice" })).toBeVisible();
  await expect(page.getByText("sample data").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyse new data" })).toHaveCount(0);
});

import { expect, test } from "@playwright/test";

const findingResponse = {
  findings: [
    {
      id: "finding-1",
      topic: "Agreement signature",
      type: "DIRECT",
      severity: "HIGH",
      evidence1: { quote: "No. I never signed that agreement." },
      evidence2: { quote: "Mine. I signed it on June 4." },
      explanation: "The witness expressly denies and later admits signing the agreement.",
      classificationConfidence: {
        score: 85,
        level: "HIGH",
        factors: [
          {
            code: "COMMON_BASE",
            label: "All classifications use the same evidence-neutral starting score",
            impact: 50,
          },
          {
            code: "BOTH_QUOTES_VERIFIED",
            label: "Both quotations exactly match their source transcripts",
            impact: 20,
          },
        ],
      },
    },
  ],
  rejectedCount: 0,
  duplicateCount: 0,
  classificationConflictCount: 0,
};

test("analyzes transcripts and exposes confidence details", async ({ page }) => {
  await page.route("**/api/analyze", async (route) => {
    const requestBody = route.request().postDataJSON();
    expect(requestBody.transcript1).toContain("Marcus Webb");
    expect(requestBody.transcript2).toContain("Marcus Webb");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(findingResponse),
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Deposition Contradiction Detector/ })).toBeVisible();
  await expect(page.getByText("Transcript 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Transcript 2", { exact: true })).toBeVisible();
  await expect(page.locator("#transcript-1")).toContainText("March 14, 2023");
  await expect(page.locator("#transcript-2")).toContainText("September 9, 2023");

  await page.getByRole("button", { name: "Find Contradictions" }).click();

  await expect(page.getByRole("heading", { name: "Results (1 found)" })).toBeVisible();
  await expect(page.getByText("DIRECT", { exact: true })).toBeVisible();
  await expect(page.getByText("Confidence: 85 · HIGH")).toBeVisible();
  await expect(page.getByText("No. I never signed that agreement.")).toBeVisible();
  await expect(page.getByText("Transcript 1:", { exact: true })).toBeVisible();
  await expect(page.getByText("Transcript 2:", { exact: true })).toBeVisible();

  await page.getByText("How confidence was calculated").click();
  await expect(page.getByText(/not supplied by Claude/)).toBeVisible();
  await expect(page.getByText("Both quotations exactly match their source transcripts")).toBeVisible();
});

test("shows a safe API error and restores the analyze button", async ({ page }) => {
  await page.route("**/api/analyze", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "The upstream analysis service failed." }),
    });
  });

  await page.goto("/");
  const analyzeButton = page.getByRole("button", { name: "Find Contradictions" });
  await analyzeButton.click();

  await expect(page.getByRole("alert")).toHaveText(
    "Failed: The upstream analysis service failed.",
  );
  await expect(analyzeButton).toBeEnabled();
  await expect(page.getByRole("heading", { name: /Results/ })).toHaveCount(0);
});

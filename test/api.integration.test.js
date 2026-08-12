import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { AnthropicRequestError } from "../server/anthropic.js";
import { createApp } from "../server/app.js";

// Supertest drives the real Express route while the injected model dependency
// keeps the suite deterministic, offline, and free of API cost.
const transcript1 = "Q: Did you sign the agreement?\nA: No. I never signed that agreement.";
const transcript2 =
  "Q: Whose signature is on the agreement?\nA: Mine. I signed it on June 4.";

const directCandidate = {
  topic: "Agreement signature",
  severity: "HIGH",
  evidence1: { quote: "No. I never signed that agreement." },
  evidence2: { quote: "Mine. I signed it on June 4." },
  canBothBeTrue: false,
  requiresExternalInference: false,
  explanation: "The witness expressly denies and later admits signing the agreement.",
};

function toolResponse(findings) {
  return {
    content: [
      {
        type: "tool_use",
        name: "report_deposition_findings",
        input: { findings },
      },
    ],
  };
}

function testApp(callAnthropic, options = {}) {
  return createApp({
    callAnthropic,
    apiKey: "test-api-key",
    model: "test-model",
    serveStatic: false,
    logger: { error() {} },
    ...options,
  });
}

test("POST /api/analyze returns verified, classified, and scored findings", async () => {
  let receivedArguments;
  const app = testApp(async (arguments_) => {
    receivedArguments = arguments_;
    return toolResponse([directCandidate]);
  });

  const response = await request(app)
    .post("/api/analyze")
    .send({ transcript1, transcript2 })
    .expect(200);

  assert.equal(receivedArguments.model, "test-model");
  assert.equal(response.body.findings.length, 1);
  assert.equal(response.body.findings[0].type, "DIRECT");
  assert.equal(response.body.findings[0].evidence1.verified, true);
  assert.equal(response.body.findings[0].classificationConfidence.score, 85);
  assert.equal(response.body.findings[0].classificationConfidence.level, "HIGH");
});

test("POST /api/analyze rejects invalid transcript input before calling Claude", async () => {
  let called = false;
  const app = testApp(async () => {
    called = true;
    return toolResponse([]);
  });

  const response = await request(app)
    .post("/api/analyze")
    .send({ transcript1: "", transcript2 })
    .expect(400);

  assert.equal(called, false);
  assert.equal(response.body.error, "Invalid transcript input.");
});

test("POST /api/analyze returns a safe configuration error when the API key is absent", async () => {
  const app = testApp(async () => toolResponse([]), { apiKey: "" });

  const response = await request(app)
    .post("/api/analyze")
    .send({ transcript1, transcript2 })
    .expect(503);

  assert.equal(response.body.error, "The analysis service is not configured.");
});

test("POST /api/analyze rejects an invalid Claude structure as an upstream failure", async () => {
  const app = testApp(async () => ({ content: [{ type: "text", text: "not structured" }] }));

  const response = await request(app)
    .post("/api/analyze")
    .send({ transcript1, transcript2 })
    .expect(502);

  assert.equal(response.body.error, "The analysis service returned an invalid result.");
});

test("POST /api/analyze excludes findings whose quotations are not grounded", async () => {
  const hallucinated = {
    ...directCandidate,
    evidence1: { quote: "I absolutely signed nothing." },
  };
  const app = testApp(async () => toolResponse([hallucinated]));

  const response = await request(app)
    .post("/api/analyze")
    .send({ transcript1, transcript2 })
    .expect(200);

  assert.equal(response.body.findings.length, 0);
  assert.equal(response.body.rejectedCount, 1);
});

test("POST /api/analyze consolidates conflicting duplicates conservatively", async () => {
  const inferentialCandidate = {
    ...directCandidate,
    requiresExternalInference: true,
    explanation: "An additional inference is required.",
  };
  const app = testApp(async () => toolResponse([directCandidate, inferentialCandidate]));

  const response = await request(app)
    .post("/api/analyze")
    .send({ transcript1, transcript2 })
    .expect(200);

  assert.equal(response.body.findings.length, 1);
  assert.equal(response.body.findings[0].type, "INFERENTIAL");
  assert.equal(response.body.duplicateCount, 1);
  assert.equal(response.body.classificationConflictCount, 1);
  assert.ok(
    response.body.findings[0].classificationConfidence.factors.some(
      (factor) => factor.code === "CLASSIFICATION_CONFLICT" && factor.impact === -15,
    ),
  );
});

test("POST /api/analyze maps upstream rate limits to a safe 429 response", async () => {
  const app = testApp(async () => {
    throw new AnthropicRequestError(429, "10");
  });

  const response = await request(app)
    .post("/api/analyze")
    .send({ transcript1, transcript2 })
    .expect(429);

  assert.equal(response.headers["retry-after"], "10");
  assert.match(response.body.error, /temporarily rate limited/);
  assert.doesNotMatch(response.body.error, /Anthropic/);
});

test("POST /api/analyze maps timeouts to 504", async () => {
  const app = testApp(async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  });

  const response = await request(app)
    .post("/api/analyze")
    .send({ transcript1, transcript2 })
    .expect(504);

  assert.equal(response.body.error, "The analysis request timed out.");
});

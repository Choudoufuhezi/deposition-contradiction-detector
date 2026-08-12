import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRequestSchema,
  buildPrompt,
  candidateResponseSchema,
  consolidateCandidates,
  deriveClassification,
  extractToolInput,
  verifyFindings,
} from "../server/classification.js";

// Unit tests isolate deterministic classification, grounding, and consolidation
// behavior. They do not call Anthropic or make HTTP requests.
const candidate = {
  topic: "Location",
  severity: "HIGH",
  evidence1: { quote: "I was at home all evening." },
  evidence2: { quote: "I went out briefly." },
  canBothBeTrue: false,
  requiresExternalInference: false,
  explanation: "The statements cannot both be true.",
};

test("validates non-empty transcript input", () => {
  assert.equal(
    analyzeRequestSchema.safeParse({ transcript1: "", transcript2: "Second" }).success,
    false,
  );
});

test("builds a calibrated three-way classification prompt", () => {
  const prompt = buildPrompt("First transcript", "Second transcript");

  assert.match(prompt, /SAME PROPOSITION CHECK/);
  assert.match(prompt, /REASONABLE COMPATIBILITY CHECK/);
  assert.match(prompt, /specific building and its surrounding area/);
  assert.match(prompt, /general anesthesia cannot make a phone call/);
  assert.match(prompt, /meeting a person and recognizing the person's name/);
  assert.match(prompt, /classify the candidate as FALSE_POSITIVE and stop/);
  assert.match(prompt, /Return each unique evidence pair at most once/);
  assert.match(prompt, /Do not calculate or return a confidence score/);
  assert.match(prompt, /<transcript_1>\nFirst transcript\n<\/transcript_1>/);
  assert.match(prompt, /<transcript_2>\nSecond transcript\n<\/transcript_2>/);
});

test("requires explicit classification decision inputs", () => {
  const { canBothBeTrue, ...missingDecision } = candidate;
  const result = candidateResponseSchema.safeParse({ findings: [missingDecision] });

  assert.equal(result.success, false);
});

test("derives classification deterministically from decision inputs", () => {
  assert.equal(deriveClassification(candidate), "DIRECT");
  assert.equal(
    deriveClassification({ ...candidate, requiresExternalInference: true }),
    "INFERENTIAL",
  );
  assert.equal(
    deriveClassification({
      ...candidate,
      canBothBeTrue: true,
      requiresExternalInference: true,
    }),
    "FALSE_POSITIVE",
  );
});

test("consolidates duplicate evidence using the more conservative classification", () => {
  const result = consolidateCandidates([
    candidate,
    { ...candidate, requiresExternalInference: true, explanation: "Inference required." },
  ]);

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].type, "INFERENTIAL");
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.classificationConflictCount, 1);
});

test("extracts the forced tool result", () => {
  const result = extractToolInput({
    content: [
      {
        type: "tool_use",
        name: "report_deposition_findings",
        input: { findings: [candidate] },
      },
    ],
  });

  assert.deepEqual(result.findings, [candidate]);
});

test("verifies quotes and calculates source offsets", () => {
  const result = verifyFindings(
    [candidate],
    "Question. I was at home all evening. Next question.",
    "Question. I went out briefly. Next question.",
  );

  assert.equal(result.rejectedCount, 0);
  assert.equal(result.findings[0].evidence1.verified, true);
  assert.equal(result.findings[0].evidence1.startIndex, 10);
});

test("rejects a finding whose quote is not in its transcript", () => {
  const result = verifyFindings([candidate], "Different words", "I went out briefly.");

  assert.equal(result.findings.length, 0);
  assert.equal(result.rejectedCount, 1);
});

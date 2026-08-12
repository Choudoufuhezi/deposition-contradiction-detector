import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRequestSchema,
  buildPrompt,
  candidateResponseSchema,
  consolidateCandidates,
  deriveClassification,
  deriveSeverity,
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
  claims1: ["remained at home for the entire evening"],
  claims2: ["left home during the evening"],
  matchedClaim1: "remained at home for the entire evening",
  matchedClaim2: "left home during the evening",
  samePredicateOrExplicitOpposite: true,
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
  assert.match(prompt, /did not authorize the wire transfer/);
  assert.match(prompt, /nonstop flight from 1:00 to 4:00/);
  assert.match(prompt, /inventory lists fifty-two boxes/);
  assert.match(prompt, /particular suite and a building's common lobby/);
  assert.match(prompt, /broad geographic area does not imply knowledge/);
  assert.match(prompt, /municipal complex/);
  assert.match(prompt, /Do not create a geographic-knowledge conflict/);
  assert.match(prompt, /same predicate or explicit logical opposites/);
  assert.match(prompt, /claims1 and claims2/);
  assert.match(prompt, /matchedClaim1 and matchedClaim2/);
  assert.match(prompt, /decompose each quotation into atomic claims/);
  assert.match(prompt, /cannot be DIRECT when samePredicateOrExplicitOpposite is false/);
  assert.match(prompt, /broader invented concept such as "contact"/);
  assert.match(prompt, /working alone does not expressly deny/);
  assert.match(prompt, /not restarted between the two observations/);
  assert.match(prompt, /Never return decision inputs that contradict the explanation/);
  assert.doesNotMatch(prompt, /Hargrove|Daniel Cho|general anesthesia|neighbor/);
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
  assert.equal(
    deriveClassification({
      ...candidate,
      samePredicateOrExplicitOpposite: false,
      requiresExternalInference: false,
    }),
    "INFERENTIAL",
  );
});

test("requires atomic claims, a matched pair, and the direct-conflict gate", () => {
  const { claims1, ...missingClaims } = candidate;
  const { matchedClaim1, ...missingMatch } = candidate;
  const { samePredicateOrExplicitOpposite, ...missingGate } = candidate;

  assert.equal(
    candidateResponseSchema.safeParse({ findings: [missingClaims] }).success,
    false,
  );
  assert.equal(candidateResponseSchema.safeParse({ findings: [missingMatch] }).success, false);
  assert.equal(candidateResponseSchema.safeParse({ findings: [missingGate] }).success, false);
});

test("requires each selected claim to belong to its atomic claim array", () => {
  const invalidMatch = {
    ...candidate,
    matchedClaim2: "an invented umbrella claim",
  };

  assert.equal(candidateResponseSchema.safeParse({ findings: [invalidMatch] }).success, false);
});

test("normalizes false-positive severity to low", () => {
  assert.equal(
    deriveSeverity({ ...candidate, severity: "HIGH", canBothBeTrue: true }),
    "LOW",
  );
  assert.equal(deriveSeverity(candidate), "HIGH");
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

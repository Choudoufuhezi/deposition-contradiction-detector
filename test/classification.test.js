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
  reasoningBasis: "UNIVERSAL_CLAIM_VIOLATION",
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
  assert.match(prompt, /universal state covering an entire stated period/);
  assert.match(prompt, /claims1 and claims2/);
  assert.match(prompt, /matchedClaim1 and matchedClaim2/);
  assert.match(prompt, /decompose each quotation into atomic claims/);
  assert.match(prompt, /select exactly one value/);
  assert.match(prompt, /UNIVERSAL_CLAIM_VIOLATION/);
  assert.match(prompt, /broader invented concept such as "contact"/);
  assert.match(prompt, /working alone does not expressly deny/);
  assert.match(prompt, /not restarted between the two observations/);
  assert.match(prompt, /Never return a reasoningBasis that contradicts the explanation/);
  assert.doesNotMatch(prompt, /Hargrove|Daniel Cho|general anesthesia|neighbor/);
  assert.match(prompt, /classify the candidate as FALSE_POSITIVE and stop/);
  assert.match(prompt, /Return each unique evidence pair at most once/);
  assert.match(prompt, /Do not calculate or return a confidence score/);
  assert.match(prompt, /<transcript_1>\nFirst transcript\n<\/transcript_1>/);
  assert.match(prompt, /<transcript_2>\nSecond transcript\n<\/transcript_2>/);
});

test("requires one explicit classification basis", () => {
  const { reasoningBasis, ...missingDecision } = candidate;
  const result = candidateResponseSchema.safeParse({ findings: [missingDecision] });

  assert.equal(result.success, false);
});

test("maps each reasoning basis deterministically", () => {
  assert.equal(deriveClassification(candidate), "DIRECT");
  assert.equal(
    deriveClassification({ ...candidate, reasoningBasis: "EXPLICIT_MUTUAL_EXCLUSION" }),
    "DIRECT",
  );
  assert.equal(
    deriveClassification({ ...candidate, reasoningBasis: "INFERENCE_REQUIRED" }),
    "INFERENTIAL",
  );
  assert.equal(
    deriveClassification({ ...candidate, reasoningBasis: "REASONABLY_COMPATIBLE" }),
    "FALSE_POSITIVE",
  );
});

test("represents incompatible approximate time estimates with an inference basis", () => {
  const approximateTimes = {
    ...candidate,
    evidence1: { quote: "Around 10, maybe 10:30." },
    evidence2: { quote: "It was late. Midnight maybe." },
    matchedClaim1: "fell asleep around 10 or 10:30",
    matchedClaim2: "fell asleep around midnight",
    claims1: ["fell asleep around 10 or 10:30"],
    claims2: ["fell asleep around midnight"],
    reasoningBasis: "INFERENCE_REQUIRED",
  };

  assert.equal(deriveClassification(approximateTimes), "INFERENTIAL");
});

test("represents an explicit denial with the direct mutual-exclusion basis", () => {
  const explicitDenial = {
    ...candidate,
    evidence1: { quote: "I never signed the agreement." },
    evidence2: { quote: "I signed it at 10:00 a.m." },
    claims1: ["did not sign the agreement"],
    claims2: ["signed the agreement"],
    matchedClaim1: "did not sign the agreement",
    matchedClaim2: "signed the agreement",
    reasoningBasis: "EXPLICIT_MUTUAL_EXCLUSION",
  };

  assert.equal(deriveClassification(explicitDenial), "DIRECT");
});

test("allows directly exclusive period claims to be DIRECT despite different verbs", () => {
  assert.equal(deriveClassification(candidate), "DIRECT");
});

test("maps compatible geographic scopes from their single reasoning basis", () => {
  const scopedLocation = {
    ...candidate,
    evidence1: { quote: "No, never. I don't even know where that is." },
    evidence2: { quote: "I've driven through that part of town." },
    claims1: ["did not know where the warehouse was"],
    claims2: ["drove through that part of town"],
    matchedClaim1: "did not know where the warehouse was",
    matchedClaim2: "drove through that part of town",
    reasoningBasis: "REASONABLY_COMPATIBLE",
  };

  const result = consolidateCandidates([scopedLocation]);

  assert.equal(result.candidates[0].type, "FALSE_POSITIVE");
  assert.equal(result.candidates[0].severity, "LOW");
});

test("maps a broad denial and specific admission from the direct basis", () => {
  const broadDenial = {
    ...candidate,
    evidence1: { quote: "I was never in that industrial area." },
    evidence2: { quote: "I entered the warehouse." },
    claims1: ["was never in the industrial area"],
    claims2: ["entered the warehouse"],
    matchedClaim1: "was never in the industrial area",
    matchedClaim2: "entered the warehouse",
    reasoningBasis: "EXPLICIT_MUTUAL_EXCLUSION",
  };
  const result = consolidateCandidates([broadDenial]);

  assert.equal(result.candidates[0].type, "DIRECT");
});

test("requires atomic claims, a matched pair, and the reasoning basis", () => {
  const { claims1, ...missingClaims } = candidate;
  const { matchedClaim1, ...missingMatch } = candidate;
  const { reasoningBasis, ...missingBasis } = candidate;

  assert.equal(
    candidateResponseSchema.safeParse({ findings: [missingClaims] }).success,
    false,
  );
  assert.equal(candidateResponseSchema.safeParse({ findings: [missingMatch] }).success, false);
  assert.equal(candidateResponseSchema.safeParse({ findings: [missingBasis] }).success, false);
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
    deriveSeverity({
      ...candidate,
      severity: "HIGH",
      reasoningBasis: "REASONABLY_COMPATIBLE",
    }),
    "LOW",
  );
  assert.equal(deriveSeverity(candidate), "HIGH");
});

test("consolidates duplicate evidence using the more conservative classification", () => {
  const result = consolidateCandidates([
    candidate,
    {
      ...candidate,
      reasoningBasis: "INFERENCE_REQUIRED",
      explanation: "Inference required.",
    },
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

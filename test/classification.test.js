import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRequestSchema,
  candidateResponseSchema,
  extractToolInput,
  verifyFindings,
} from "../server/classification.js";

const candidate = {
  topic: "Location",
  type: "DIRECT",
  severity: "HIGH",
  evidence1: { quote: "I was at home all evening." },
  evidence2: { quote: "I went out briefly." },
  explanation: "The statements cannot both be true.",
};

test("validates non-empty transcript input", () => {
  assert.equal(
    analyzeRequestSchema.safeParse({ transcript1: "", transcript2: "Second" }).success,
    false,
  );
});

test("rejects an unsupported classification", () => {
  const result = candidateResponseSchema.safeParse({
    findings: [{ ...candidate, type: "POSSIBLE" }],
  });

  assert.equal(result.success, false);
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

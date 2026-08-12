import test from "node:test";
import assert from "node:assert/strict";
import { calculateClassificationConfidence } from "../server/confidence.js";

// Hand-authored findings make each rubric input and expected score repeatable.
function finding(overrides = {}) {
  return {
    type: "DIRECT",
    evidence1: {
      quote: "No, I never signed that agreement.",
      question: "Did you sign the purchase agreement?",
      verified: true,
      completeStatement: true,
    },
    evidence2: {
      quote: "Yes. I signed it on June 4.",
      question: "Whose signature appears on the purchase agreement?",
      verified: true,
      completeStatement: true,
    },
    stability: { duplicateCount: 0, classificationConflict: false },
    ...overrides,
  };
}

test("scores a grounded direct contradiction with absolute language highly", () => {
  const confidence = calculateClassificationConfidence(finding());

  assert.equal(confidence.score, 85);
  assert.equal(confidence.level, "HIGH");
  assert.ok(confidence.factors.some((factor) => factor.code === "BOTH_QUOTES_VERIFIED"));
  assert.ok(confidence.factors.some((factor) => factor.code === "ABSOLUTE_LANGUAGE_ONE"));
});

test("reduces confidence for hedged language", () => {
  const confidence = calculateClassificationConfidence(
    finding({
      type: "INFERENTIAL",
      evidence1: {
        quote: "Around 10, maybe 10:30.",
        verified: true,
        completeStatement: true,
        question: "What time did you go to sleep?",
      },
      evidence2: {
        quote: "Midnight maybe.",
        verified: true,
        completeStatement: true,
        question: "What time did you go to sleep?",
      },
    }),
  );

  const hedgeFactor = confidence.factors.find((factor) => factor.code === "HEDGED_LANGUAGE");
  assert.equal(hedgeFactor.impact, -8);
  assert.ok(
    confidence.factors.some((factor) => factor.code === "TEMPORAL_INFERENCE_SUPPORTED"),
  );
});

test("rewards a false positive supported by geographic scope", () => {
  const confidence = calculateClassificationConfidence(
    finding({
      type: "FALSE_POSITIVE",
      evidence1: {
        quote: "No, never.",
        verified: true,
        completeStatement: true,
        question: "Have you been to the warehouse?",
      },
      evidence2: {
        quote: "I drove through that general area.",
        verified: true,
        completeStatement: true,
        question: "Have you visited that part of town?",
      },
    }),
  );

  assert.ok(
    confidence.factors.some((factor) => factor.code === "LOCATION_SCOPE_COMPATIBLE"),
  );
});

test("penalizes conflicting duplicate classifications", () => {
  const confidence = calculateClassificationConfidence(
    finding({ stability: { duplicateCount: 1, classificationConflict: true } }),
  );

  assert.ok(
    confidence.factors.some(
      (factor) => factor.code === "CLASSIFICATION_CONFLICT" && factor.impact === -15,
    ),
  );
  assert.equal(
    confidence.factors.some((factor) => factor.code === "DUPLICATE_FINDING"),
    false,
  );
});

test("clamps scores and applies documented thresholds", () => {
  const confidence = calculateClassificationConfidence(
    finding({
      type: "INFERENTIAL",
      evidence1: {
        quote: "Maybe, I think it was around there or something.",
        verified: false,
        completeStatement: false,
        question: null,
      },
      evidence2: {
        quote: "I might possibly have been nearby, probably.",
        verified: false,
        completeStatement: false,
        question: null,
      },
      stability: { duplicateCount: 1, classificationConflict: true },
    }),
  );

  assert.ok(confidence.score >= 0 && confidence.score <= 100);
  assert.equal(confidence.level, "LOW");
});

test("uses the same base score for every classification", () => {
  for (const type of ["DIRECT", "INFERENTIAL", "FALSE_POSITIVE"]) {
    const confidence = calculateClassificationConfidence(finding({ type }));
    const base = confidence.factors.find((factor) => factor.code === "COMMON_BASE");

    assert.equal(base.impact, 50);
  }
});

import { randomUUID } from "node:crypto";
import { z } from "zod";

// Model-owned fields deliberately exclude `type` and `confidence`. Claude
// supplies auditable decision inputs; application code derives the final label.
export const analyzeRequestSchema = z.object({
  transcript1: z.string().trim().min(1, "Transcript 1 is required").max(100_000),
  transcript2: z.string().trim().min(1, "Transcript 2 is required").max(100_000),
});

const evidenceSchema = z.object({
  quote: z.string().trim().min(1),
});

export const candidateFindingSchema = z
  .object({
    topic: z.string().trim().min(1),
    severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
    evidence1: evidenceSchema,
    evidence2: evidenceSchema,
    claims1: z.array(z.string().trim().min(1)).min(1).max(10),
    claims2: z.array(z.string().trim().min(1)).min(1).max(10),
    matchedClaim1: z.string().trim().min(1),
    matchedClaim2: z.string().trim().min(1),
    samePredicateOrExplicitOpposite: z.boolean(),
    canBothBeTrue: z.boolean(),
    requiresExternalInference: z.boolean(),
    explanation: z.string().trim().min(1),
  })
  .superRefine((candidate, context) => {
    if (!candidate.claims1.includes(candidate.matchedClaim1)) {
      context.addIssue({
        code: "custom",
        path: ["matchedClaim1"],
        message: "matchedClaim1 must exactly match an item in claims1",
      });
    }

    if (!candidate.claims2.includes(candidate.matchedClaim2)) {
      context.addIssue({
        code: "custom",
        path: ["matchedClaim2"],
        message: "matchedClaim2 must exactly match an item in claims2",
      });
    }
  });

export const candidateResponseSchema = z.object({
  findings: z.array(candidateFindingSchema).max(50),
});

/** JSON Schema exposed to Claude as a forced client tool. */
export const reportFindingsTool = {
  name: "report_deposition_findings",
  description:
    "Report every material comparison found between two depositions. Each finding must compare one exact quotation from transcript 1 with one exact quotation from transcript 2. Use an empty findings array when there are no meaningful comparisons.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      findings: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            topic: { type: "string" },
            severity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            evidence1: {
              type: "object",
              additionalProperties: false,
              properties: { quote: { type: "string" } },
              required: ["quote"],
            },
            evidence2: {
              type: "object",
              additionalProperties: false,
              properties: { quote: { type: "string" } },
              required: ["quote"],
            },
            claims1: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: { type: "string" },
              description:
                "Atomic claims from evidence1. Each item must contain exactly one narrow action or state and must not broaden it into an umbrella concept.",
            },
            claims2: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: { type: "string" },
              description:
                "Atomic claims from evidence2. Each item must contain exactly one narrow action or state and must not broaden it into an umbrella concept.",
            },
            matchedClaim1: {
              type: "string",
              description:
                "The single atomic claim from claims1 that is being compared. Copy it exactly from claims1.",
            },
            matchedClaim2: {
              type: "string",
              description:
                "The single atomic claim from claims2 that is being compared. Copy it exactly from claims2.",
            },
            samePredicateOrExplicitOpposite: {
              type: "boolean",
              description:
                "True only when matchedClaim1 and matchedClaim2 assert the same precise action or state, or explicit logical opposites. False for merely related predicates.",
            },
            canBothBeTrue: {
              type: "boolean",
              description:
                "True when an ordinary reasonable interpretation allows both quoted witness statements to be true.",
            },
            requiresExternalInference: {
              type: "boolean",
              description:
                "True when incompatibility depends on an unstated fact, causal rule, timeline implication, specialized knowledge, or common-sense assumption.",
            },
            explanation: { type: "string" },
          },
          required: [
            "topic",
            "severity",
            "evidence1",
            "evidence2",
            "claims1",
            "claims2",
            "matchedClaim1",
            "matchedClaim2",
            "samePredicateOrExplicitOpposite",
            "canBothBeTrue",
            "requiresExternalInference",
            "explanation",
          ],
        },
      },
    },
    required: ["findings"],
  },
};

/**
 * Builds the legal classification prompt and its calibration examples.
 * Transcript tags delimit user-generated content from application instructions.
 */
export function buildPrompt(transcript1, transcript2) {
  return `You are reviewing two legal deposition transcripts from the same witness. Identify material statement pairs and classify each pair as DIRECT, INFERENTIAL, or FALSE_POSITIVE.

Apply this decision process to every candidate, in this exact order:

1. SAME PROPOSITION CHECK
Determine whether both statements concern the same person, event, relevant time, object, and level of geographic or semantic scope. Read the preceding question when interpreting pronouns such as "it" or "that". A shared word or nearby location is not enough to establish the same proposition.

2. REASONABLE COMPATIBILITY CHECK
Ask whether a reasonable interpretation allows both statements to be true. Account for qualifiers such as "around", "about", "maybe", "might", "I think", and "I don't remember exactly". Also account for differences in the asserted predicate or scope. Test compatibility before considering any implication: if one statement concerns a specific room, person, action, or relationship while the other concerns a broader place or a related but different action, do not silently expand either claim. Knowledge of, presence in, or travel through a broad geographic area does not imply knowledge of every specific building, address, room, or sub-location within it. A statement about a specific place and a statement about its broader containing area are compatible unless both statements explicitly identify the same location or add another express conflict. If an ordinary interpretation allows both statements to be true, classify the candidate as FALSE_POSITIVE and stop. Do not continue searching for an implied conflict based on tone, impression, assumed intent, general familiarity, or a broader meaning suggested by the question.

3. DIRECT CONTRADICTION CHECK
Classify as DIRECT only when the witness statements themselves assert mutually exclusive facts about the same proposition and no additional fact, causal rule, specialized knowledge, or common-sense assumption is required to see the conflict. The statements must use the same predicate or explicit logical opposites, such as "authorized" versus "did not authorize" or "owned" versus "had no ownership interest." Do not merge different predicates under a broader invented concept such as "contact", "presence", "familiarity", "involvement", or "interaction". Explicit denials or universal terms such as "no", "never", "always", and "the entire time" create a direct contradiction only within the scope of the exact action or state they modify. If the explanation relies on language such as "implies", "requires interpreting", "common-sense inference", or any other unstated bridge, the finding cannot be DIRECT.

4. INFERENTIAL CONTRADICTION CHECK
Classify as INFERENTIAL only when each statement can sound consistent in isolation, but they become incompatible after a necessary timeline, causal, physical, or contextual inference. Non-overlapping times are not automatically DIRECT when incompatibility depends on what must have remained true between those times. State the necessary bridge explicitly in the explanation. Do not use INFERENTIAL merely because one statement is hedged or less specific, and do not use it after the compatibility check has found a reasonable way for both statements to be true.

Before reporting a candidate, record the decision inputs accurately:
- claims1 and claims2: decompose each quotation into atomic claims. Each item must contain exactly one narrow action or state. For example, "I did not call her, and I was alone" contains two claims, not one claim about "contact". Never use umbrella concepts such as contact, interaction, presence, familiarity, or involvement unless that exact concept is expressly stated by the witness.
- matchedClaim1 and matchedClaim2: select exactly one atomic claim from each array for the comparison. Copy each selected string exactly from its claims array. Do not compare an entire multi-claim answer to another entire answer.
- samePredicateOrExplicitOpposite: true only when matchedClaim1 and matchedClaim2 are the same precise predicate or explicit logical opposites. Related actions, incidental interactions, or different geographic scopes are false.
- canBothBeTrue: true when an ordinary reasonable interpretation permits both witness statements to be true; otherwise false.
- requiresExternalInference: true when finding incompatibility requires any unstated fact, causal rule, timeline implication, specialized knowledge, or common-sense assumption; otherwise false.
The application, not you, derives the final classification from these fields. canBothBeTrue takes priority. A pair cannot be DIRECT when samePredicateOrExplicitOpposite is false. Before submitting, confirm that matchedClaim1 occurs exactly in claims1 and matchedClaim2 occurs exactly in claims2. Do not include a classification label in the explanation.

Calibration examples:
- "I did not authorize the wire transfer" vs "I authorized that wire transfer" => DIRECT, because the same action is expressly denied and affirmed.
- "I remained on a nonstop flight from 1:00 to 4:00" vs "I entered the downtown office at 2:15" => INFERENTIAL, because incompatibility depends on inferring that the witness could not be aboard the flight and inside the office at the same time.
- "There were about fifty boxes" vs "The inventory lists fifty-two boxes" => FALSE_POSITIVE, because an approximate quantity can reasonably include fifty-two.
- "I never entered Suite 410" vs "I waited in the building lobby" => FALSE_POSITIVE, because a particular suite and a building's common lobby have different geographic scope.
- "I do not know where the archive room is" vs "I have walked through the municipal complex" => FALSE_POSITIVE, because familiarity with a broad complex does not establish knowledge of a particular room inside it.
- "I had no ownership interest in the company" vs "I owned two hundred shares in the company" => DIRECT, because share ownership expressly contradicts the denial of any ownership interest.
- "I had never spoken with the consultant" vs "I recognized the consultant's name from a report" => FALSE_POSITIVE, because speaking with a person and recognizing that person's name are different predicates and can both be true.
- "I worked alone in my office" vs "I briefly nodded to the receptionist" => FALSE_POSITIVE, because working alone does not expressly deny every brief nonverbal acknowledgment; the predicates are different and both statements can be true.
- "I turned the equipment off around 9:00" vs "The equipment was operating at 11:00" => INFERENTIAL, because the conflict depends on inferring that it was not restarted between the two observations.

Output requirements:
- Include only meaningful comparison pairs. Do not manufacture a counterpart when one transcript is silent on a topic.
- Return each unique evidence pair at most once. Before submitting, remove duplicate comparisons, including duplicates with different proposed reasoning.
- Include false positives when they are plausible candidates that a naive contradiction detector might flag.
- Copy each evidence quote verbatim from its respective transcript. Do not paraphrase or combine non-contiguous text inside a quotation.
- Use the questions as context, but quote the witness statements as evidence.
- Do not broaden a witness's answer using the wording or implication of a question. Distinguish the action actually denied or affirmed from related but different actions, and distinguish a specific location or relationship from a broader one.
- In the explanation, identify the decisive wording, relevant scope, qualifier, or required inference that determines the classification.
- Check that the explanation is logically consistent with the selected type. If the explanation introduces an unstated fact or rule, DIRECT is invalid. If the explanation acknowledges that both statements can reasonably be true, DIRECT and INFERENTIAL are invalid.
- Audit the explanation before submitting: if it uses "implies", "requires interpreting", "common-sense inference", or a newly invented umbrella predicate, set requiresExternalInference to true or canBothBeTrue to true as appropriate. Never return decision inputs that contradict the explanation.
- Do not create a geographic-knowledge conflict by inferring that passing through or recognizing a broad area establishes knowledge of a specific sub-location.
- Do not invent facts, assume unstated events, or resolve genuine ambiguity against the witness.
- Severity means potential importance for legal review, not certainty or classification confidence.
- Do not calculate or return a confidence score.

<transcript_1>
${transcript1}
</transcript_1>

<transcript_2>
${transcript2}
</transcript_2>`;
}

/**
 * Grounds model quotations against their designated source transcript.
 * Ungrounded findings are rejected rather than displayed with reduced trust.
 * Verified offsets support future source highlighting and deterministic scoring.
 */
export function verifyFindings(candidates, transcript1, transcript2) {
  const findings = [];
  let rejectedCount = 0;

  for (const candidate of candidates) {
    const start1 = transcript1.indexOf(candidate.evidence1.quote);
    const start2 = transcript2.indexOf(candidate.evidence2.quote);

    if (start1 === -1 || start2 === -1) {
      rejectedCount += 1;
      continue;
    }

    findings.push({
      id: randomUUID(),
      ...candidate,
      evidence1: {
        transcriptId: "TRANSCRIPT_1",
        quote: candidate.evidence1.quote,
        startIndex: start1,
        endIndex: start1 + candidate.evidence1.quote.length,
        verified: true,
        completeStatement: isCompleteStatement(
          candidate.evidence1.quote,
          transcript1,
          start1,
        ),
        question: findPrecedingQuestion(transcript1, start1),
      },
      evidence2: {
        transcriptId: "TRANSCRIPT_2",
        quote: candidate.evidence2.quote,
        startIndex: start2,
        endIndex: start2 + candidate.evidence2.quote.length,
        verified: true,
        completeStatement: isCompleteStatement(
          candidate.evidence2.quote,
          transcript2,
          start2,
        ),
        question: findPrecedingQuestion(transcript2, start2),
      },
    });
  }

  return { findings, rejectedCount };
}

function findPrecedingQuestion(transcript, quoteStart) {
  const beforeQuote = transcript.slice(0, quoteStart);
  const questions = [...beforeQuote.matchAll(/^Q:\s*(.+)$/gim)];
  return questions.at(-1)?.[1]?.trim() || null;
}

// A quote is complete only when it exactly covers the answer on its source line.
// This is intentionally conservative; multi-line transcript formats may require
// a richer parser in a future version.
function isCompleteStatement(quote, transcript, quoteStart) {
  const lineStart = transcript.lastIndexOf("\n", quoteStart) + 1;
  const nextLineBreak = transcript.indexOf("\n", quoteStart);
  const lineEnd = nextLineBreak === -1 ? transcript.length : nextLineBreak;
  const sourceLine = transcript.slice(lineStart, lineEnd).replace(/^A:\s*/i, "").trim();
  return normalizeEvidenceQuote(sourceLine) === normalizeEvidenceQuote(quote);
}

/**
 * Derives the three-way label from structured decision inputs.
 * Compatibility takes precedence, followed by inference, then direct conflict.
 */
export function deriveClassification(candidate) {
  if (candidate.canBothBeTrue) return "FALSE_POSITIVE";
  if (!candidate.samePredicateOrExplicitOpposite || candidate.requiresExternalInference) {
    return "INFERENTIAL";
  }
  return "DIRECT";
}

/**
 * Normalizes model-provided legal-review severity after classification.
 * A false positive is not a contradiction, so presenting it as medium or high
 * severity would be misleading. Actual contradictions retain the model's
 * case-importance estimate, which remains separate from confidence.
 */
export function deriveSeverity(candidate, type = deriveClassification(candidate)) {
  return type === "FALSE_POSITIVE" ? "LOW" : candidate.severity;
}

function normalizeEvidenceQuote(quote) {
  return quote.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

const conservatismRank = {
  DIRECT: 0,
  INFERENTIAL: 1,
  FALSE_POSITIVE: 2,
};

/**
 * Deduplicates identical evidence pairs and preserves the safer classification
 * when Claude returns conflicting analyses of the same quotes.
 *
 * Conservative order: FALSE_POSITIVE > INFERENTIAL > DIRECT. Per-finding
 * stability metadata is retained for the confidence rubric.
 */
export function consolidateCandidates(candidates) {
  const candidatesByEvidence = new Map();
  let duplicateCount = 0;
  let classificationConflictCount = 0;

  for (const candidate of candidates) {
    const classifiedCandidate = {
      ...candidate,
      type: deriveClassification(candidate),
    };
    classifiedCandidate.severity = deriveSeverity(candidate, classifiedCandidate.type);
    const key = [
      normalizeEvidenceQuote(candidate.evidence1.quote),
      normalizeEvidenceQuote(candidate.evidence2.quote),
    ].join("\u0000");
    const existing = candidatesByEvidence.get(key);

    if (!existing) {
      candidatesByEvidence.set(key, {
        ...classifiedCandidate,
        stability: { duplicateCount: 0, classificationConflict: false },
      });
      continue;
    }

    duplicateCount += 1;

    if (existing.type !== classifiedCandidate.type) {
      classificationConflictCount += 1;
    }

    const classificationConflict = existing.type !== classifiedCandidate.type;
    const selected =
      conservatismRank[classifiedCandidate.type] > conservatismRank[existing.type]
        ? classifiedCandidate
        : existing;

    candidatesByEvidence.set(key, {
      ...selected,
      stability: {
        duplicateCount: existing.stability.duplicateCount + 1,
        classificationConflict:
          existing.stability.classificationConflict || classificationConflict,
      },
    });
  }

  return {
    candidates: [...candidatesByEvidence.values()],
    duplicateCount,
    classificationConflictCount,
  };
}

/** Extracts and validates the single forced tool-use payload from Claude. */
export function extractToolInput(apiResponse) {
  const toolUse = apiResponse?.content?.find(
    (block) => block.type === "tool_use" && block.name === reportFindingsTool.name,
  );

  if (!toolUse) {
    throw new Error("Claude did not return the required structured result");
  }

  return candidateResponseSchema.parse(toolUse.input);
}

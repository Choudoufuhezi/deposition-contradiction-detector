import { randomUUID } from "node:crypto";
import { z } from "zod";

export const analyzeRequestSchema = z.object({
  transcript1: z.string().trim().min(1, "Transcript 1 is required").max(100_000),
  transcript2: z.string().trim().min(1, "Transcript 2 is required").max(100_000),
});

const evidenceSchema = z.object({
  quote: z.string().trim().min(1),
});

export const candidateFindingSchema = z.object({
  topic: z.string().trim().min(1),
  severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
  evidence1: evidenceSchema,
  evidence2: evidenceSchema,
  canBothBeTrue: z.boolean(),
  requiresExternalInference: z.boolean(),
  explanation: z.string().trim().min(1),
});

export const candidateResponseSchema = z.object({
  findings: z.array(candidateFindingSchema).max(50),
});

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

export function buildPrompt(transcript1, transcript2) {
  return `You are reviewing two legal deposition transcripts from the same witness. Identify material statement pairs and classify each pair as DIRECT, INFERENTIAL, or FALSE_POSITIVE.

Apply this decision process to every candidate, in this exact order:

1. SAME PROPOSITION CHECK
Determine whether both statements concern the same person, event, relevant time, object, and level of geographic or semantic scope. Read the preceding question when interpreting pronouns such as "it" or "that". A shared word or nearby location is not enough to establish the same proposition.

2. REASONABLE COMPATIBILITY CHECK
Ask whether a reasonable interpretation allows both statements to be true. Account for qualifiers such as "around", "about", "maybe", "might", "I think", and "I don't remember exactly". Also account for differences in the asserted predicate or scope, such as meeting someone in person versus recognizing the person's name. If an ordinary interpretation allows both statements to be true, classify the candidate as FALSE_POSITIVE and stop. Do not continue searching for an implied conflict based on tone, impression, assumed intent, or a broader meaning suggested by the question.

3. DIRECT CONTRADICTION CHECK
Classify as DIRECT only when the witness statements themselves assert mutually exclusive facts about the same proposition and no additional fact, causal rule, specialized knowledge, or common-sense assumption is required to see the conflict. Explicit denials or universal terms such as "no", "never", "all evening", and "I'd never heard of him" can create a direct contradiction when the other statement expressly asserts the opposite fact. If the explanation must introduce an unstated proposition such as "a person under general anesthesia cannot make a phone call," the finding cannot be DIRECT.

4. INFERENTIAL CONTRADICTION CHECK
Classify as INFERENTIAL only when each statement can sound consistent in isolation, but they become incompatible after a necessary timeline or contextual inference. State that necessary inference in the explanation. Do not use INFERENTIAL merely because one statement is hedged or less specific.

Before reporting a candidate, record the decision inputs accurately:
- canBothBeTrue: true when an ordinary reasonable interpretation permits both witness statements to be true; otherwise false.
- requiresExternalInference: true when finding incompatibility requires any unstated fact, causal rule, timeline implication, specialized knowledge, or common-sense assumption; otherwise false.
The application, not you, derives the final classification from these fields. Do not include a classification label in the explanation.

Calibration examples:
- "I was home all night" vs "I stepped out around 7" => DIRECT, because staying home all night and leaving at 7 cannot both be true.
- "I went to sleep at 10" vs "I was up until midnight" => INFERENTIAL, because the conflict follows by inferring that a sleeping person was not up during that period.
- "It happened around 8" vs "It happened at 8:05" => FALSE_POSITIVE, because an approximate time includes 8:05.
- "I have never been to that warehouse" vs "I have driven through that general area" => FALSE_POSITIVE, because a specific building and its surrounding area have different geographic scope.
- "I had never heard of Daniel" vs "I knew of Daniel" => DIRECT, because the second statement expressly negates the first.
- "I was under general anesthesia from 1:00 to 4:00" vs "I made a phone call at 2:30" => INFERENTIAL, because incompatibility depends on the additional inference that a person under general anesthesia cannot consciously make and conduct that call.
- "I had never met her in person" vs "I recognized her name from company emails" => FALSE_POSITIVE, because meeting a person and recognizing the person's name are different predicates and can both be true.
- "I did not speak to anyone; I was alone" vs "A neighbor might have seen me and we waved" => INFERENTIAL, not DIRECT. Speaking, being seen, waving, and being accompanied are distinct facts; any conflict requires interpreting "alone" as excluding even brief nonverbal interaction.

Output requirements:
- Include only meaningful comparison pairs. Do not manufacture a counterpart when one transcript is silent on a topic.
- Return each unique evidence pair at most once. Before submitting, remove duplicate comparisons, including duplicates with different proposed reasoning.
- Include false positives when they are plausible candidates that a naive contradiction detector might flag.
- Copy each evidence quote verbatim from its respective transcript. Do not paraphrase or combine non-contiguous text inside a quotation.
- Use the questions as context, but quote the witness statements as evidence.
- Do not broaden a witness's answer using the wording or implication of a question. Denying that one spoke to someone is not a denial of being seen, and denying an in-person meeting is not a denial of recognizing a name.
- In the explanation, identify the decisive wording, relevant scope, qualifier, or required inference that determines the classification.
- Check that the explanation is logically consistent with the selected type. If the explanation introduces an unstated fact or rule, DIRECT is invalid. If the explanation acknowledges that both statements can reasonably be true, DIRECT and INFERENTIAL are invalid.
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

function isCompleteStatement(quote, transcript, quoteStart) {
  const lineStart = transcript.lastIndexOf("\n", quoteStart) + 1;
  const nextLineBreak = transcript.indexOf("\n", quoteStart);
  const lineEnd = nextLineBreak === -1 ? transcript.length : nextLineBreak;
  const sourceLine = transcript.slice(lineStart, lineEnd).replace(/^A:\s*/i, "").trim();
  return normalizeEvidenceQuote(sourceLine) === normalizeEvidenceQuote(quote);
}

export function deriveClassification(candidate) {
  if (candidate.canBothBeTrue) return "FALSE_POSITIVE";
  if (candidate.requiresExternalInference) return "INFERENTIAL";
  return "DIRECT";
}

function normalizeEvidenceQuote(quote) {
  return quote.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

const conservatismRank = {
  DIRECT: 0,
  INFERENTIAL: 1,
  FALSE_POSITIVE: 2,
};

export function consolidateCandidates(candidates) {
  const candidatesByEvidence = new Map();
  let duplicateCount = 0;
  let classificationConflictCount = 0;

  for (const candidate of candidates) {
    const classifiedCandidate = {
      ...candidate,
      type: deriveClassification(candidate),
    };
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

export function extractToolInput(apiResponse) {
  const toolUse = apiResponse?.content?.find(
    (block) => block.type === "tool_use" && block.name === reportFindingsTool.name,
  );

  if (!toolUse) {
    throw new Error("Claude did not return the required structured result");
  }

  return candidateResponseSchema.parse(toolUse.input);
}

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
  type: z.enum(["DIRECT", "INFERENTIAL", "FALSE_POSITIVE"]),
  severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
  evidence1: evidenceSchema,
  evidence2: evidenceSchema,
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
            type: {
              type: "string",
              enum: ["DIRECT", "INFERENTIAL", "FALSE_POSITIVE"],
            },
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
            explanation: { type: "string" },
          },
          required: [
            "topic",
            "type",
            "severity",
            "evidence1",
            "evidence2",
            "explanation",
          ],
        },
      },
    },
    required: ["findings"],
  },
};

export function buildPrompt(transcript1, transcript2) {
  return `Compare the two deposition transcripts from the same witness and classify material differences.

Classification rules:
- DIRECT: the witness makes explicit factual claims about the same subject, event, and time that cannot both be true.
- INFERENTIAL: the claims do not directly negate each other, but the surrounding facts or timeline make them logically incompatible. Explain the required inference.
- FALSE_POSITIVE: the wording differs but the claims can reasonably both be true, including approximate times, hedging, differing geographic scope, or ordinary imprecision.

Requirements:
- Compare only statements about the same subject, event, and relevant time.
- Copy evidence quotes verbatim from their respective transcripts. Do not paraphrase quotations.
- Do not invent facts or resolve ambiguity against the witness.
- Include false positives when they are plausible candidates a naive detector might flag.
- Severity means potential importance for legal review, not certainty.
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
      },
      evidence2: {
        transcriptId: "TRANSCRIPT_2",
        quote: candidate.evidence2.quote,
        startIndex: start2,
        endIndex: start2 + candidate.evidence2.quote.length,
        verified: true,
      },
    });
  }

  return { findings, rejectedCount };
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

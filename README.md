# Deposition Contradiction Detector

React prototype for comparing two deposition transcripts and surfacing potential contradictions.

## Run locally

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env`, add an Anthropic API key, and then start the app. The Vite
frontend runs on port `5173` and proxies `/api` requests to the Express server on port `3001`.

## Classification confidence

`classificationConfidence` is a deterministic application score. Claude does not return a
confidence value, and its prose explanation is never used as a scoring input. The score helps
prioritize human review; it is not a calibrated probability or a legal conclusion.

The score is clamped to `0–100`. Every classification begins at the same evidence-neutral base;
the label itself never earns a prior bonus or penalty. A classification only affects how an
independently detected signal is interpreted—for example, a time difference inside an
approximation window supports `FALSE_POSITIVE` but weakens `DIRECT`.

| Factor | Impact |
| --- | ---: |
| Common base for every classification | +50 |
| Both quotes exactly verified in their source transcripts | +20 |
| Both quotes contain complete answers | +10 |
| Only one quote contains a complete answer | +3 |
| Absolute language in one quote (`never`, `no`, `all`, etc.), for a scope-aligned direct contradiction | +5 |
| Absolute language in both quotes, for a scope-aligned direct contradiction | +8 |
| Each distinct hedge (`maybe`, `might`, `around`, etc.) | -4, capped at -16 |
| False-positive times fall inside the applicable approximation window | +10 |
| Direct-contradiction times fall inside the applicable approximation window | -15 |
| Parsed timeline supports an inferential contradiction | +8 |
| Both statements reference the same explicit date | +5 |
| Different explicit dates support a false positive | +8 |
| Different explicit dates weaken a contradiction | -12 |
| Specific-place versus broader-area scope supports a false positive | +10 |
| Specific-place versus broader-area scope weakens a contradiction | -15 |
| Duplicate evidence pair with the same classification | -3 |
| Duplicate evidence pair with conflicting classifications | -15 |

Time approximation windows are deterministic:

| Wording | Tolerance |
| --- | ---: |
| Exact time | 15 minutes |
| `around`, `about`, or `approximately` | 30 minutes |
| `maybe`, `might`, or `I think` | 45 minutes |

Confidence levels use these thresholds:

| Score | Level |
| --- | --- |
| 80–100 | `HIGH` |
| 60–79 | `MEDIUM` |
| 0–59 | `LOW` |

Every returned factor includes a code, human-readable label, and signed impact so reviewers can
audit how the final score was produced. Exact quote matching, statement completeness, dates,
times, location scope, hedged language, and duplicate stability are evaluated from transcript
evidence and server-side rules—not from Claude's explanation.

## Testing

```sh
npm test
```

The test suite uses Node's built-in test runner. Supertest sends real HTTP requests through the
Express application while an injected Anthropic dependency returns deterministic tool-use
fixtures, so integration tests never call Claude or incur API cost. Separate tests verify the
outbound Anthropic URL, authentication/version headers, model, prompt, and forced tool schema.

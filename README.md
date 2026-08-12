# Deposition Contradiction Detector

A full-stack React and Express application that compares two deposition transcripts from the
same witness, asks Claude to identify material statement pairs, classifies each pair, verifies
the quoted evidence, and calculates an application-owned confidence score.

The application distinguishes:

- `DIRECT`: the same proposition is expressly asserted and denied.
- `INFERENTIAL`: incompatibility requires a necessary timeline, causal, or contextual inference.
- `FALSE_POSITIVE`: an ordinary interpretation allows both statements to be true.

Severity represents potential legal-review importance, not classification certainty. Claude
provides severity for actual contradictions; the server always normalizes `FALSE_POSITIVE` to
`LOW` because a dismissed candidate should not appear as a high-priority contradiction.

This tool supports human legal review. Its results and confidence values are not legal conclusions.

## Architecture

```text
React client
    |
    | POST /api/analyze
    v
Express API
    |
    | validated transcripts + forced JSON tool schema
    v
Anthropic Messages API
    |
    | candidate evidence + decision inputs
    v
Server post-processing
    |- validate model structure with Zod
    |- derive DIRECT / INFERENTIAL / FALSE_POSITIVE
    |- consolidate duplicate evidence pairs conservatively
    |- verify every quote against its source transcript
    `- calculate deterministic classification confidence
```

Claude does not provide the final confidence score. It also does not provide the final
classification label directly. Claude returns atomic claims, one matched claim pair, and three
structured decision inputs:

```text
claims1[]
claims2[]
matchedClaim1
matchedClaim2
samePredicateOrExplicitOpposite
canBothBeTrue
requiresExternalInference
```

The server derives the label in this order:

```text
canBothBeTrue = true                         -> FALSE_POSITIVE
canBothBeTrue = false + distinct predicates  -> INFERENTIAL
canBothBeTrue = false + inference required   -> INFERENTIAL
same/opposite predicate + no inference       -> DIRECT
```

## Run locally

Requirements:

- Node.js 22 or later
- An Anthropic API key with access to the configured model

Create local configuration:

```sh
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Set the API key in `.env`:

```dotenv
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-6
PORT=3001
```

Install and start both development processes:

```sh
npm install
npm run dev
```

If PowerShell blocks npm scripts, use:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:5173`. Vite proxies `/api` requests to Express on port `3001`.

## Production run

```sh
npm run build
npm start
```

Express serves both `/api/analyze` and the compiled React application from `dist` on port `3001`
unless `PORT` is overridden.

## API contract

### `POST /api/analyze`

Request:

```json
{
  "transcript1": "Q: ...\nA: ...",
  "transcript2": "Q: ...\nA: ..."
}
```

Successful response, abbreviated:

```json
{
  "findings": [
    {
      "id": "generated-uuid",
      "topic": "Agreement signature",
      "type": "DIRECT",
      "severity": "HIGH",
      "evidence1": {
        "transcriptId": "TRANSCRIPT_1",
        "quote": "No. I never signed that agreement.",
        "startIndex": 37,
        "endIndex": 71,
        "verified": true,
        "completeStatement": true
      },
      "evidence2": {
        "transcriptId": "TRANSCRIPT_2",
        "quote": "Mine. I signed it on June 4.",
        "verified": true,
        "completeStatement": true
      },
      "explanation": "...",
      "classificationConfidence": {
        "score": 85,
        "level": "HIGH",
        "factors": [
          {
            "code": "BOTH_QUOTES_VERIFIED",
            "label": "Both quotations exactly match their source transcripts",
            "impact": 20
          }
        ]
      }
    }
  ],
  "rejectedCount": 0,
  "duplicateCount": 0,
  "classificationConflictCount": 0
}
```

The API returns safe, normalized errors:

| Status | Meaning |
| --- | --- |
| `400` | Missing, empty, or oversized transcript input |
| `429` | Upstream model rate limit; `Retry-After` is forwarded when available |
| `502` | Upstream failure or structurally invalid model result |
| `503` | Server API key is not configured |
| `504` | Model request exceeded the 60-second timeout |

## Classification confidence

`classificationConfidence` is deterministic application logic. Claude does not return a
confidence value, and its prose explanation is never used as a scoring input. The score helps
prioritize human review; it is not a calibrated probability or a legal conclusion.

The score is clamped to `0-100`. Every classification begins at the same evidence-neutral base;
the label itself never earns a prior bonus or penalty. A classification only affects how an
independently detected signal is interpreted. For example, a time difference inside an
approximation window supports `FALSE_POSITIVE` but weakens `DIRECT`.

### Scoring rubric

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

Confidence thresholds:

| Score | Level |
| --- | --- |
| 80-100 | `HIGH` |
| 60-79 | `MEDIUM` |
| 0-59 | `LOW` |

Every factor includes a stable code, human-readable label, and signed impact so a reviewer can
audit the score. Quote matching, statement completeness, dates, times, location scope, hedged
language, and duplicate stability come from transcript evidence and server-side rules.

## Testing

```sh
npm test
```

The main suite uses Node's built-in test runner. Playwright specs run separately so the two test
runtimes do not discover each other's files:

- Unit tests cover prompt invariants, schema validation, label derivation, quote grounding,
  duplicate consolidation, time/location heuristics, and confidence thresholds.
- Supertest sends real HTTP requests through Express while an injected Anthropic dependency
  returns deterministic fixtures. These tests never call Claude or incur API cost.
- Provider-boundary tests verify the Anthropic URL, authentication/version headers, model,
  prompt, timeout configuration, and forced tool schema using an injected `fetch` function.

Run a production build check with:

```sh
npm run build
```

Run the mocked browser smoke tests with:

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright starts the Vite client and intercepts `/api/analyze` in the browser, so the smoke tests
cover transcript submission, result rendering, expandable confidence factors, safe errors, and
button recovery without starting Express or calling Claude.

## Project structure

```text
server/
  anthropic.js       Anthropic Messages API boundary
  app.js             Express application and HTTP error mapping
  classification.js Prompt, schemas, label derivation, grounding, and deduplication
  confidence.js      Deterministic confidence rubric and parsers
  index.js           Environment loading and process startup
src/
  App.jsx            Transcript input and finding presentation
  styles.css         Responsive application styles
test/
  anthropic.test.js        Provider request contract
  api.integration.test.js  Express endpoint integration tests
  classification.test.js   Classification pipeline unit tests
  confidence.test.js       Confidence rubric unit tests
  e2e/app.spec.js          Mocked browser workflow smoke tests
```

## Current limitations

- Classification quality still depends on the selected model and prompt calibration.
- Transcript parsing assumes `Q:` and `A:` line-oriented text; other formats may reduce the
  complete-statement score.
- Time, date, and location checks are intentionally narrow heuristics, not a general legal NLP
  parser.
- Confidence weights have not been statistically calibrated against attorney-labeled data.
- Severity for actual contradictions is model-provided review importance and remains separate from
  classification confidence; false positives are normalized to `LOW`.
- No authentication, persistent case storage, file upload, OCR, or document-redaction workflow is
  included in this take-home scope.

For a production legal system, the next step would be attorney-labeled evaluation data, weight
calibration, access controls, audit logging, retention policies, and formal security review.

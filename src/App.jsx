import { useState } from "react";

// Two depositions from the same witness, six months apart.
const TRANSCRIPT_1 = `
Deposition of Marcus Webb — March 14, 2023

Q: Where were you on the evening of November 3rd?
A: I was at home all evening. I ordered pizza around 7pm and watched TV.

Q: Did you speak to anyone that night?
A: No, I was alone. My wife was visiting her sister in Portland.

Q: What time did you go to sleep?
A: Around 10, maybe 10:30. I had work the next morning.

Q: Have you ever been to the Hargrove Street warehouse?
A: No, never. I don't even know where that is.

Q: Do you own a grey Honda Civic?
A: I did at the time, yes. I sold it in January.

Q: Had you met Daniel Cho before November 3rd?
A: No. I'd never heard of him before this whole thing started.
`;

const TRANSCRIPT_2 = `
Deposition of Marcus Webb — September 9, 2023

Q: Walk me through the evening of November 3rd again.
A: I was home. I think I went out briefly to get some groceries, maybe around 7:30, but came right back.

Q: You mentioned last time you ordered pizza. Now you're saying groceries?
A: I might have done both. I don't remember exactly, it was almost a year ago.

Q: Did anyone see you that evening?
A: My neighbor, Tom, might have seen me. We waved or something in the parking lot.

Q: What time did you go to sleep?
A: It was late. Midnight maybe. I had trouble sleeping.

Q: Had you ever visited the Hargrove Street area?
A: I mean, I've driven through that part of town. I didn't say I'd never been in that general area.

Q: And Daniel Cho — did you know him?
A: I knew of him. We had mutual friends. I don't think I'd met him face to face.
`;

const TYPE_STYLES = {
  DIRECT: { accent: "#ef4444", background: "#fee2e2" },
  INFERENTIAL: { accent: "#f59e0b", background: "#fef3c7" },
  FALSE_POSITIVE: { accent: "#9ca3af", background: "#f3f4f6" },
};

export default function App() {
  const [transcript1, setTranscript1] = useState(TRANSCRIPT_1.trim());
  const [transcript2, setTranscript2] = useState(TRANSCRIPT_2.trim());
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [classificationConflictCount, setClassificationConflictCount] = useState(0);
  const [error, setError] = useState(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setResults(null);
    setRejectedCount(0);
    setDuplicateCount(0);
    setClassificationConflictCount(0);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript1,
          transcript2,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "The analysis request failed.");
      }

      setResults(data.findings);
      setRejectedCount(data.rejectedCount);
      setDuplicateCount(data.duplicateCount);
      setClassificationConflictCount(data.classificationConflictCount);
    } catch (caughtError) {
      setError(`Failed: ${caughtError.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <h1>⚖️ Deposition Contradiction Detector</h1>

      <section className="transcript-grid" aria-label="Deposition transcripts">
        <Transcript
          id="transcript-1"
          title="Transcript — March 2023"
          value={transcript1}
          onChange={setTranscript1}
        />
        <Transcript
          id="transcript-2"
          title="Transcript — September 2023"
          value={transcript2}
          onChange={setTranscript2}
        />
      </section>

      <button
        className="analyze-button"
        onClick={analyze}
        disabled={loading || !transcript1.trim() || !transcript2.trim()}
      >
        {loading ? "Analyzing..." : "Find Contradictions"}
      </button>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {results && (
        <Results
          results={results}
          rejectedCount={rejectedCount}
          duplicateCount={duplicateCount}
          classificationConflictCount={classificationConflictCount}
        />
      )}
    </main>
  );
}

function Transcript({ id, title, value, onChange }) {
  return (
    <article>
      <label className="transcript-title" htmlFor={id}>
        {title}
      </label>
      <textarea
        className="transcript-copy"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck="false"
      />
    </article>
  );
}

function Results({ results, rejectedCount, duplicateCount, classificationConflictCount }) {
  return (
    <section className="results" aria-live="polite">
      <h2>Results ({results.length} found)</h2>
      {rejectedCount > 0 && (
        <p className="verification-note">
          {rejectedCount} unverified model {rejectedCount === 1 ? "finding was" : "findings were"}{" "}
          excluded because the quoted evidence was not found in the transcripts.
        </p>
      )}
      {duplicateCount > 0 && (
        <p className="verification-note">
          {duplicateCount} duplicate model {duplicateCount === 1 ? "finding was" : "findings were"}{" "}
          consolidated
          {classificationConflictCount > 0
            ? `, including ${classificationConflictCount} conflicting classification ${classificationConflictCount === 1 ? "that was" : "that were"} resolved conservatively`
            : ""}
          .
        </p>
      )}
      {results.length === 0 && (
        <p className="empty-results">No verified comparisons were found.</p>
      )}
      {results.map((result) => {
        const style = TYPE_STYLES[result.type] ?? TYPE_STYLES.FALSE_POSITIVE;

        return (
          <article
            className="result-card"
            key={result.id}
            style={{ borderLeftColor: style.accent }}
          >
            <div className="result-metadata">
              <span className="type-chip" style={{ background: style.background }}>
                {result.type}
              </span>
              <span className="severity">Severity: {result.severity}</span>
            </div>
            <div className="claims">
              <p>
                <strong>March:</strong> “{result.evidence1.quote}”
              </p>
              <p>
                <strong>September:</strong> “{result.evidence2.quote}”
              </p>
            </div>
            <p className="explanation">{result.explanation}</p>
          </article>
        );
      })}
    </section>
  );
}

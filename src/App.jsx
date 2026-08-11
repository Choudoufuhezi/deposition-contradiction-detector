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
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `Find contradictions between these two depositions from the same witness.

Transcript 1: ${TRANSCRIPT_1}

Transcript 2: ${TRANSCRIPT_2}

Return a JSON array of contradictions like: [{claim1, claim2, type, severity}]
Types: DIRECT, INFERENTIAL, or FALSE_POSITIVE
Severity: HIGH, MEDIUM, LOW`,
            },
          ],
        }),
      });

      const data = await response.json();
      const text = data.content[0].text;
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setResults(parsed);
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
        <Transcript title="Transcript — March 2023" text={TRANSCRIPT_1} />
        <Transcript title="Transcript — September 2023" text={TRANSCRIPT_2} />
      </section>

      <button className="analyze-button" onClick={analyze} disabled={loading}>
        {loading ? "Analyzing..." : "Find Contradictions"}
      </button>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {results && <Results results={results} />}
    </main>
  );
}

function Transcript({ title, text }) {
  return (
    <article>
      <h2 className="transcript-title">{title}</h2>
      <pre className="transcript-copy">{text}</pre>
    </article>
  );
}

function Results({ results }) {
  return (
    <section className="results" aria-live="polite">
      <h2>Results ({results.length} found)</h2>
      {results.map((result, index) => {
        const style = TYPE_STYLES[result.type] ?? TYPE_STYLES.FALSE_POSITIVE;

        return (
          <article
            className="result-card"
            key={`${result.claim1}-${result.claim2}-${index}`}
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
                <strong>March:</strong> “{result.claim1}”
              </p>
              <p>
                <strong>September:</strong> “{result.claim2}”
              </p>
            </div>
          </article>
        );
      })}
    </section>
  );
}

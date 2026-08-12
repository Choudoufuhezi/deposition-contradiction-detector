import { buildPrompt, reportFindingsTool } from "./classification.js";

/**
 * Typed upstream failure used to keep Anthropic response details out of the
 * public API while preserving status metadata needed for error mapping.
 */
export class AnthropicRequestError extends Error {
  constructor(status, retryAfter = null) {
    super(`Anthropic request failed with status ${status}`);
    this.name = "AnthropicRequestError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/**
 * Calls Anthropic's Messages API and forces one structured tool-use response.
 *
 * `fetchImpl` is injectable so tests can inspect the outbound request without
 * making a network call. Confidence is intentionally absent from this request:
 * it is calculated later by deterministic application code.
 */
export async function callAnthropic({
  transcript1,
  transcript2,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: buildPrompt(transcript1, transcript2),
        },
      ],
      tools: [reportFindingsTool],
      tool_choice: {
        type: "tool",
        name: reportFindingsTool.name,
        disable_parallel_tool_use: true,
      },
    }),
  });

  // Parse even failed responses so the connection can be consumed cleanly, but
  // never expose the provider's error body to clients.
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AnthropicRequestError(response.status, response.headers.get("retry-after"));
  }

  return payload;
}

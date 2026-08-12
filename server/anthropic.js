import { buildPrompt, reportFindingsTool } from "./classification.js";

export class AnthropicRequestError extends Error {
  constructor(status, retryAfter = null) {
    super(`Anthropic request failed with status ${status}`);
    this.name = "AnthropicRequestError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

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

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AnthropicRequestError(response.status, response.headers.get("retry-after"));
  }

  return payload;
}

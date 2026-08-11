import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { ZodError } from "zod";
import {
  analyzeRequestSchema,
  buildPrompt,
  extractToolInput,
  reportFindingsTool,
  verifyFindings,
} from "./classification.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const directory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(directory, "../dist");

app.disable("x-powered-by");
app.use(express.json({ limit: "250kb" }));

app.post("/api/analyze", async (request, response) => {
  try {
    const { transcript1, transcript2 } = analyzeRequestSchema.parse(request.body);
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return response.status(503).json({
        error: "ANTHROPIC_API_KEY is not configured on the server.",
      });
    }

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
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

    const payload = await anthropicResponse.json().catch(() => null);

    if (!anthropicResponse.ok) {
      const message = payload?.error?.message || "Claude request failed";
      return response.status(anthropicResponse.status).json({ error: message });
    }

    const { findings: candidates } = extractToolInput(payload);
    return response.json(verifyFindings(candidates, transcript1, transcript2));
  } catch (error) {
    if (error instanceof ZodError) {
      return response.status(400).json({
        error: "Invalid analysis data.",
        details: error.issues.map((issue) => issue.message),
      });
    }

    if (error?.name === "TimeoutError") {
      return response.status(504).json({ error: "Claude request timed out." });
    }

    console.error(error);
    return response.status(502).json({ error: "Unable to analyze the transcripts." });
  }
});

app.use(express.static(distDirectory));
app.get("/{*path}", (request, response, next) => {
  if (request.path.startsWith("/api/")) return next();
  return response.sendFile(path.join(distDirectory, "index.html"));
});

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});

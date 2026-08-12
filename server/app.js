import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { AnthropicRequestError, callAnthropic as defaultCallAnthropic } from "./anthropic.js";
import { attachClassificationConfidence } from "./confidence.js";
import {
  analyzeRequestSchema,
  consolidateCandidates,
  extractToolInput,
  verifyFindings,
} from "./classification.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultDistDirectory = path.resolve(directory, "../dist");

export function createApp({
  callAnthropic = defaultCallAnthropic,
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  serveStatic = true,
  distDirectory = defaultDistDirectory,
  logger = console,
} = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "250kb" }));

  app.post("/api/analyze", async (request, response) => {
    const requestResult = analyzeRequestSchema.safeParse(request.body);
    if (!requestResult.success) {
      return response.status(400).json({
        error: "Invalid transcript input.",
        details: requestResult.error.issues.map((issue) => issue.message),
      });
    }

    if (!apiKey) {
      return response.status(503).json({
        error: "The analysis service is not configured.",
      });
    }

    const { transcript1, transcript2 } = requestResult.data;

    try {
      const payload = await callAnthropic({ transcript1, transcript2, apiKey, model });
      const { findings: rawCandidates } = extractToolInput(payload);
      const { candidates, duplicateCount, classificationConflictCount } =
        consolidateCandidates(rawCandidates);
      const verified = verifyFindings(candidates, transcript1, transcript2);

      return response.json({
        ...verified,
        findings: attachClassificationConfidence(verified.findings),
        duplicateCount,
        classificationConflictCount,
      });
    } catch (error) {
      if (error?.name === "TimeoutError") {
        return response.status(504).json({ error: "The analysis request timed out." });
      }

      if (error instanceof AnthropicRequestError && error.status === 429) {
        if (error.retryAfter) response.set("Retry-After", error.retryAfter);
        return response.status(429).json({
          error: "The analysis service is temporarily rate limited. Please try again.",
        });
      }

      if (error instanceof AnthropicRequestError) {
        return response.status(502).json({
          error: "The upstream analysis service failed.",
        });
      }

      logger.error(error);
      return response.status(502).json({
        error: "The analysis service returned an invalid result.",
      });
    }
  });

  if (serveStatic) {
    app.use(express.static(distDirectory));
    app.get("/{*path}", (request, response, next) => {
      if (request.path.startsWith("/api/")) return next();
      return response.sendFile(path.join(distDirectory, "index.html"));
    });
  }

  return app;
}

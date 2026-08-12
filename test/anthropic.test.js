import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicRequestError, callAnthropic } from "../server/anthropic.js";

test("callAnthropic sends the required authenticated structured-output request", async () => {
  let capturedUrl;
  let capturedOptions;
  const payload = { content: [] };
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      async json() {
        return payload;
      },
    };
  };

  const result = await callAnthropic({
    transcript1: "First transcript",
    transcript2: "Second transcript",
    apiKey: "secret-test-key",
    model: "test-model",
    fetchImpl,
  });

  const body = JSON.parse(capturedOptions.body);
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.headers["x-api-key"], "secret-test-key");
  assert.equal(capturedOptions.headers["anthropic-version"], "2023-06-01");
  assert.equal(body.model, "test-model");
  assert.equal(body.temperature, 0);
  assert.equal(body.tool_choice.type, "tool");
  assert.equal(body.tool_choice.name, "report_deposition_findings");
  assert.equal(body.tool_choice.disable_parallel_tool_use, true);
  assert.match(body.messages[0].content, /First transcript/);
  assert.match(body.messages[0].content, /Second transcript/);
  assert.equal(result, payload);
});

test("callAnthropic converts non-success responses into safe typed errors", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    headers: new Headers({ "retry-after": "15" }),
    async json() {
      return { error: { message: "sensitive upstream details" } };
    },
  });

  await assert.rejects(
    callAnthropic({
      transcript1: "First transcript",
      transcript2: "Second transcript",
      apiKey: "secret-test-key",
      model: "test-model",
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof AnthropicRequestError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, "15");
      assert.doesNotMatch(error.message, /sensitive upstream details/);
      return true;
    },
  );
});

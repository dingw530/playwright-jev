import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionRequest, parseDecision, validateChoiceAnswer, TypeSafeDecisionClient, redactText } from "../src/typesafe-client.mjs";
import { buildActionSpace } from "../src/action-space.mjs";

const actionSpace = buildActionSpace([{
  role: "main",
  children: [
    { role: "textbox", name: "Email", ref: "e1" },
    { role: "button", name: "Sign in", ref: "e2" },
  ],
}]);

test("builds operation and compatible target heads in one request", () => {
  const request = buildDecisionRequest({
    goal: "Sign in",
    page: { url: "http://test", title: "Login", text: "Login" },
    actionSpace,
    history: [],
  });
  assert.ok(request.questions.operation);
  assert.ok(request.questions.click_target);
  assert.ok(request.questions.type_text_target);
  assert.equal(request.questions.click_target.criteria.e2.element.includes("Sign in"), true);
});

test("rejects a Jev answer outside the closed action space", () => {
  assert.throws(() => validateChoiceAnswer({
    type: "choice",
    choice: "invented",
    probabilities: { e1: 1 },
  }, ["e1"]), /outside the current action space/);
});

test("only validates the selected operation target head", () => {
  const request = buildDecisionRequest({
    goal: "Click sign in",
    page: { url: "http://test", title: "Login", text: "Login" },
    actionSpace,
    history: [],
  });
  const result = parseDecision({
    model: "jev-1.13.0",
    answers: {
      operation: { type: "choice", choice: "CLICK", probabilities: { CLICK: 1, TYPE_TEXT: 0, SCROLL_DOWN: 0, SCROLL_UP: 0, WAIT: 0, DONE: 0, BLOCKED: 0 }, confidence: 1 },
      click_target: { type: "choice", choice: "e2", probabilities: { e1: 0, e2: 1 }, confidence: 1 },
      type_text_target: { type: "choice", choice: "not-used", probabilities: { "not-used": 1 }, confidence: 1 },
    },
  }, { questions: request.questions });
  assert.equal(result.actionId, "e2");
  assert.equal(result.operation, "CLICK");
});

test("sends the documented System One request shape", async () => {
  let request;
  const client = new TypeSafeDecisionClient({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      request = { headers: options.headers, body: JSON.parse(options.body) };
      const operationProbabilities = Object.fromEntries(Object.keys(request.body.questions.operation.criteria).map((id) => [id, id === "CLICK" ? 1 : 0]));
      const targetProbabilities = Object.fromEntries(Object.keys(request.body.questions.click_target.criteria).map((id) => [id, id === "e2" ? 1 : 0]));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "jev-1.13.0",
          answers: {
            operation: { type: "choice", choice: "CLICK", probabilities: operationProbabilities, confidence: 1 },
            click_target: { type: "choice", choice: "e2", probabilities: targetProbabilities, confidence: 1 },
          },
          usage: { input_tokens: 10, output_tokens: 3 },
        }),
      };
    },
  });
  const result = await client.decide({
    goal: "Click sign in",
    page: { url: "http://test", title: "Login", text: "Login" },
    actionSpace,
    history: [],
  });
  assert.equal(request.headers.Authorization, "Bearer test-key");
  assert.equal(request.body.model, "jev-latest");
  assert.equal(request.body.questions.operation.type, "choice");
  assert.equal(result.actionId, "e2");
  assert.equal(typeof result.latencyMs, "number");
  assert.equal(result.attempts, 1);
});

test("redacts configured input values from Jev state", () => {
  const request = buildDecisionRequest({
    goal: "Sign in",
    page: { url: "http://test", title: "Login", text: "tester@example.com" },
    actionSpace: buildActionSpace([{ role: "main", children: [{ role: "textbox", name: "Email", value: "tester@example.com", ref: "e1" }] }]),
    history: [],
    redactions: ["tester@example.com", "secret"],
  });
  assert.equal(request.state.page.visible_text, "<redacted>");
  assert.equal(request.state.elements[0].value, "<filled>");
  assert.equal(redactText("secret and tester@example.com", ["secret", "tester@example.com"]), "<redacted> and <redacted>");
});

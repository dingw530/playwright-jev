import test from "node:test";
import assert from "node:assert/strict";
import { buildActionSpace, candidateById } from "../src/action-space.mjs";

const snapshot = [{
  role: "main",
  children: [
    { role: "textbox", name: "Email", value: "", ref: "e1" },
    { role: "textbox", name: "Password", value: "", ref: "e2" },
    { role: "button", name: "Sign in", ref: "e3" },
    { role: "checkbox", name: "Remember me", checked: false, ref: "e4" },
  ],
}];

test("builds a bounded operation-specific action space", () => {
  const actionSpace = buildActionSpace(snapshot);
  assert.deepEqual(actionSpace.byOperation.TYPE_TEXT.map((item) => item.id), ["e1", "e2"]);
  assert.deepEqual(actionSpace.byOperation.CLICK.map((item) => item.id), ["e1", "e2", "e3"]);
  assert.deepEqual(actionSpace.byOperation.CHECK.map((item) => item.id), ["e4"]);
  assert.equal(candidateById(actionSpace, "e1", "CLICK").operation, "CLICK");
  assert.equal(candidateById(actionSpace, "e1", "TYPE_TEXT").operation, "TYPE_TEXT");
});

test("does not expose more candidates than the configured limit", () => {
  const many = Array.from({ length: 4 }, (_, index) => ({ role: "button", name: `Button ${index}`, ref: `e${index}` }));
  const actionSpace = buildActionSpace([{ role: "main", children: many }], { maxCandidates: 2 });
  assert.equal(actionSpace.candidates.length, 2);
  assert.equal(actionSpace.omitted, 2);
});

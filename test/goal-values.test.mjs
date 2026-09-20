import test from "node:test";
import assert from "node:assert/strict";
import { extractGoalValues, inputFromGoal } from "../src/goal-values.mjs";

test("extracts a numeric value from a natural-language goal", () => {
  assert.deepEqual(extractGoalValues("打开 orders 为 1042 的条目并完成 dispatch"), ["1042"]);
});

test("uses the goal value only when one editable target and one value are present", () => {
  assert.equal(inputFromGoal("打开 orders 为 1042 的条目", [{ label: "Search orders" }]), "1042");
  assert.equal(inputFromGoal("打开 orders 为 1042 的条目", [{ label: "Search orders" }, { label: "Customer" }]), undefined);
});

test("does not guess when the goal contains multiple numeric values", () => {
  assert.equal(inputFromGoal("打开 orders 为 1042 的条目，再检查 2024 年记录", [{ label: "Search orders" }]), undefined);
});

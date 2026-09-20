import test from "node:test";
import assert from "node:assert/strict";
import { buildSpecFromOptions, parseOptions, shortcutTraceBasename } from "../src/cli-options.mjs";

test("parses the URL and goal shortcut with repeatable inputs and assertions", () => {
  const parsed = parseOptions([
    "--url", "http://127.0.0.1:4173/",
    "--goal", "Sign in and show Orders",
    "--input", "Email=tester@example.com",
    "--input", "Password=secret=with=equals",
    "--assert-text", "Orders",
    "--assert-url-contains", "/orders",
    "--assert-text-not-contains", "Error",
    "--headed",
  ]);
  const spec = buildSpecFromOptions(parsed);
  assert.equal(spec.url, "http://127.0.0.1:4173/");
  assert.deepEqual(spec.inputs, { Email: "tester@example.com", Password: "secret=with=equals" });
  assert.deepEqual(spec.assertions, [
    { type: "text_contains", value: "Orders" },
    { type: "url_contains", value: "/orders" },
    { type: "text_not_contains", value: "Error" },
  ]);
  assert.equal(parsed.headed, true);
});

test("keeps JSON mode separate from shortcut mode", () => {
  const parsed = parseOptions(["examples/login.json", "--max-steps", "12"]);
  assert.equal(buildSpecFromOptions(parsed), null);
  assert.equal(parsed.max_steps, "12");
  assert.throws(
    () => buildSpecFromOptions(parseOptions(["examples/login.json", "--url", "http://test", "--goal", "go"])),
    /either <spec\.json> or shortcut options/,
  );
});

test("requires both URL and goal for shortcut mode", () => {
  assert.throws(() => buildSpecFromOptions(parseOptions(["--url", "http://test"])), /both --url URL and --goal GOAL/);
  assert.throws(() => buildSpecFromOptions(parseOptions(["--url", "http://test", "--goal", "go", "--offline"])), /--offline requires/);
});

test("creates a stable trace filename for shortcut mode", () => {
  assert.equal(shortcutTraceBasename({ name: "Northstar React / checkout" }), "northstar-react-checkout-trace.json");
});

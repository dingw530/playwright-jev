#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PlaywrightCliAdapter } from "../src/playwright-cli-adapter.mjs";
import { TypeSafeDecisionClient, ScriptedDecisionClient } from "../src/typesafe-client.mjs";
import { E2ERunner, loadSpec } from "../src/runner.mjs";
import { buildSpecFromOptions, parseOptions, shortcutTraceBasename } from "../src/cli-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function help() {
  console.log(`Usage:
  node scripts/cli.mjs <spec.json> [options]
  node scripts/cli.mjs --url URL --goal "GOAL" [options]

Options:
  --offline              Use the spec's deterministic offlineDecisions; no Jev API call
  --headed               Show the browser window instead of using headless mode
  --url URL              Shortcut mode: page URL (requires --goal)
  --goal TEXT            Shortcut mode: natural-language E2E goal (requires --url)
  --name NAME            Shortcut mode: trace name (default: Quick Jev E2E)
  --input LABEL=VALUE    Shortcut mode: deterministic field value; repeatable
  --assert-text TEXT     Shortcut mode: require visible text; repeatable
  --assert-text-not-contains TEXT
                         Shortcut mode: require text to be absent; repeatable
  --assert-url-contains TEXT
                         Shortcut mode: require URL to contain text; repeatable
  --assert-title-contains TEXT
                         Shortcut mode: require title to contain text; repeatable
  --assert-selector-visible SELECTOR
                         Shortcut mode: require a selector to be visible; repeatable
  --session NAME         playwright-cli session name (default: jev-<pid>)
  --trace FILE           Write the JSON trace to FILE
  --max-steps N          Override the spec action budget
  --confidence N         Override the spec confidence threshold
  --help                 Show this help

Live mode requires TYPESAFE_API_KEY. Page content is never treated as instructions.
The JSON spec form remains recommended for complex flows, offline scripts, and reusable CI cases.
`);
}

let parsed;
try {
  parsed = parseOptions(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(2);
}
if (parsed.help) {
  help();
  process.exit(0);
}

try {
  const shortcutSpec = buildSpecFromOptions(parsed);
  if (!parsed.specFile && !shortcutSpec) {
    help();
    process.exitCode = 2;
    process.exit();
  }
  const spec = shortcutSpec ?? await loadSpec(path.resolve(parsed.specFile));
  if (parsed.max_steps) spec.maxSteps = Number(parsed.max_steps);
  if (parsed.confidence) spec.confidenceThreshold = Number(parsed.confidence);
  const defaultTrace = parsed.specFile
    ? `${path.basename(parsed.specFile, path.extname(parsed.specFile))}-trace.json`
    : shortcutTraceBasename(spec);
  const traceFile = path.resolve(parsed.trace ?? path.join(root, "outputs", defaultTrace));
  const browser = new PlaywrightCliAdapter({ session: parsed.session ?? `jev-${process.pid}`, headed: parsed.headed });
  const decider = parsed.offline
    ? new ScriptedDecisionClient(spec.offlineDecisions ?? [])
    : new TypeSafeDecisionClient();
  const trace = await new E2ERunner({ spec, browser, decider, traceFile }).run();
  console.log(`Trace: ${traceFile}`);
  process.exitCode = trace.status === "passed" ? 0 : 1;
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}

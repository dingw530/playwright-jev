const VALUE_OPTIONS = new Set([
  "--url",
  "--goal",
  "--name",
  "--session",
  "--trace",
  "--max-steps",
  "--confidence",
  "--input",
  "--assert-text",
  "--assert-text-not-contains",
  "--assert-url-contains",
  "--assert-title-contains",
  "--assert-selector-visible",
]);

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseInput(value) {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    throw new Error(`--input must use LABEL=VALUE, received: ${value}`);
  }
  const label = value.slice(0, separator).trim();
  const inputValue = value.slice(separator + 1);
  if (!label) throw new Error("--input requires a non-empty element label");
  return [label, inputValue];
}

export function parseOptions(argv) {
  const positional = [];
  const inputs = {};
  const assertions = [];
  const result = { offline: false, inputs, assertions };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      result.help = true;
    } else if (value === "--offline") {
      result.offline = true;
    } else if (value === "--headed") {
      result.headed = true;
    } else if (VALUE_OPTIONS.has(value)) {
      const optionValue = requiredValue(argv, index, value);
      index += 1;
      const key = value.slice(2).replaceAll("-", "_");
      if (value === "--input") {
        const [label, inputValue] = parseInput(optionValue);
        if (Object.hasOwn(inputs, label)) throw new Error(`Duplicate --input label: ${label}`);
        inputs[label] = inputValue;
      } else if (value === "--assert-text") {
        assertions.push({ type: "text_contains", value: optionValue });
      } else if (value === "--assert-text-not-contains") {
        assertions.push({ type: "text_not_contains", value: optionValue });
      } else if (value === "--assert-url-contains") {
        assertions.push({ type: "url_contains", value: optionValue });
      } else if (value === "--assert-title-contains") {
        assertions.push({ type: "title_contains", value: optionValue });
      } else if (value === "--assert-selector-visible") {
        assertions.push({ type: "selector_visible", value: optionValue });
      } else {
        result[key] = optionValue;
      }
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      positional.push(value);
    }
  }

  if (positional.length > 1) throw new Error("Only one spec.json positional argument is supported");
  result.specFile = positional[0];
  return result;
}

export function buildSpecFromOptions(parsed) {
  const hasShortcutOptions = parsed.url !== undefined || parsed.goal !== undefined || parsed.name !== undefined ||
    Object.keys(parsed.inputs ?? {}).length > 0 || (parsed.assertions ?? []).length > 0;

  if (parsed.specFile && hasShortcutOptions) {
    throw new Error("Use either <spec.json> or shortcut options, not both");
  }
  if (parsed.specFile) return null;
  if (!hasShortcutOptions) return null;
  if (!parsed.url || !parsed.goal) {
    throw new Error("Provide <spec.json> or both --url URL and --goal GOAL");
  }
  if (parsed.offline) {
    throw new Error("--offline requires a JSON spec with offlineDecisions; use live Jev for shortcut mode");
  }

  return {
    name: parsed.name ?? "Quick Jev E2E",
    url: parsed.url,
    goal: parsed.goal,
    inputs: parsed.inputs,
    assertions: parsed.assertions,
  };
}

export function shortcutTraceBasename(spec) {
  const slug = String(spec.name ?? "quick-e2e")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "quick-e2e"}-trace.json`;
}

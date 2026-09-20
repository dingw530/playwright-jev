export async function evaluateAssertions(adapter, state, assertions = []) {
  const failures = [];
  for (const assertion of assertions) {
    const type = assertion.type;
    const value = String(assertion.value ?? "");
    let passed = false;
    if (type === "url_contains") passed = state.url.includes(value);
    else if (type === "url_equals") passed = state.url === value;
    else if (type === "title_contains") passed = state.title.includes(value);
    else if (type === "text_contains") passed = state.text.includes(value);
    else if (type === "text_not_contains") passed = !state.text.includes(value);
    else if (type === "selector_visible") {
      const selector = JSON.stringify(value);
      passed = Boolean(await adapter.eval(`() => { const e = document.querySelector(${selector}); return Boolean(e && e.checkVisibility ? e.checkVisibility() : e && getComputedStyle(e).visibility !== 'hidden'); }`));
    } else {
      failures.push({ assertion, error: `Unsupported assertion type: ${type}` });
      continue;
    }
    if (!passed) failures.push({ assertion, error: `Assertion failed: ${type} ${value}` });
  }
  return { passed: failures.length === 0, failures };
}

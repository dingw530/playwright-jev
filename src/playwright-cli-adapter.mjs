import { spawn } from "node:child_process";

const STATEFUL_ROLES = new Set(["textbox", "searchbox", "spinbutton", "combobox", "checkbox", "radio", "switch"]);

function parseJsonOutput(output) {
  const text = String(output ?? "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error(`playwright-cli returned no JSON: ${text.slice(-500)}`);
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch (error) {
    throw new Error(`Could not parse playwright-cli JSON: ${error.message}`);
  }
}

function decodeEvalResult(payload) {
  let result = payload?.result;
  if (typeof result !== "string") return result;
  try {
    result = JSON.parse(result);
  } catch {
    return result;
  }
  return result;
}

function snapshotNodes(nodes, result = []) {
  for (const node of nodes ?? []) {
    if (!node || typeof node !== "object") continue;
    result.push(node);
    snapshotNodes(node.children, result);
  }
  return result;
}

function mergeNodeState(nodes, stateByRef) {
  for (const node of nodes ?? []) {
    if (node?.ref && stateByRef.has(node.ref)) Object.assign(node, stateByRef.get(node.ref));
    mergeNodeState(node?.children, stateByRef);
  }
  return nodes;
}

export class PlaywrightCliAdapter {
  constructor({
    command = process.env.PLAYWRIGHT_CLI ?? "playwright-cli",
    session = `jev-${process.pid}`,
    timeoutMs = 60000,
    headed = false,
  } = {}) {
    this.command = command;
    this.session = session;
    this.timeoutMs = timeoutMs;
    this.headed = headed;
    this.opened = false;
  }

  async run(args) {
    const commandArgs = [`-s=${this.session}`, ...args, "--json"];
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, commandArgs, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`playwright-cli timed out: ${args.join(" ")}`));
      }, this.timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Could not start playwright-cli: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`playwright-cli failed (${code}): ${(stderr || stdout).trim().slice(-1000)}`));
          return;
        }
        try {
          resolve(parseJsonOutput(stdout));
        } catch (error) {
          reject(new Error(`${error.message}\n${stderr.trim()}`));
        }
      });
    });
  }

  async open(url) {
    await this.run(["open", url, ...(this.headed ? ["--headed"] : [])]);
    this.opened = true;
  }

  async close() {
    if (!this.opened) return;
    try {
      await this.run(["close"]);
    } finally {
      this.opened = false;
    }
  }

  async snapshot() {
    const payload = await this.run(["snapshot"]);
    return payload.snapshot ?? [];
  }

  async eval(expression, target) {
    const args = ["eval", expression];
    if (target) args.push(target);
    return decodeEvalResult(await this.run(args));
  }

  async observe() {
    const [snapshot, page] = await Promise.all([
      this.snapshot(),
      this.eval("() => ({ url: location.href, title: document.title, text: document.body?.innerText ?? '' })"),
    ]);
    const stateByRef = new Map();
    for (const node of snapshotNodes(snapshot)) {
      if (!node.ref || !STATEFUL_ROLES.has(node.role)) continue;
      const state = await this.eval("el => ({ value: typeof el.value === 'string' ? el.value : undefined, checked: typeof el.checked === 'boolean' ? el.checked : undefined, selected: typeof el.selected === 'boolean' ? el.selected : undefined, expanded: el.getAttribute('aria-expanded') })", node.ref);
      if (state && typeof state === "object") stateByRef.set(node.ref, state);
    }
    mergeNodeState(snapshot, stateByRef);
    return {
      snapshot,
      url: page?.url ?? "",
      title: page?.title ?? "",
      text: String(page?.text ?? "").slice(0, 12000),
    };
  }

  async execute(candidate, inputValue) {
    switch (candidate.operation) {
      case "CLICK":
        await this.run(["click", candidate.ref]);
        break;
      case "TYPE_TEXT":
        if (inputValue === undefined || inputValue === null) {
          throw new Error(`No deterministic input value configured for ${candidate.label}`);
        }
        await this.run(["fill", candidate.ref, String(inputValue)]);
        break;
      case "CHECK":
        await this.run(["check", candidate.ref]);
        break;
      case "UNCHECK":
        await this.run(["uncheck", candidate.ref]);
        break;
      case "SCROLL_DOWN":
        await this.run(["mousewheel", "0", "650"]);
        break;
      case "SCROLL_UP":
        await this.run(["mousewheel", "0", "-650"]);
        break;
      case "WAIT":
        await new Promise((resolve) => setTimeout(resolve, 150));
        break;
      default:
        throw new Error(`Unsupported executable operation: ${candidate.operation}`);
    }
  }
}

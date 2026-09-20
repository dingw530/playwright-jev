import fs from "node:fs/promises";
import path from "node:path";
import { buildActionSpace, candidateById } from "./action-space.mjs";
import { evaluateAssertions } from "./assertions.mjs";
import { inputFromGoal, extractGoalValues } from "./goal-values.mjs";
import { redactText } from "./typesafe-client.mjs";

function inputFor(spec, candidate, actionSpace) {
  const inputs = spec.inputs ?? {};
  const keys = [candidate.id, candidate.label, candidate.name].filter(Boolean);
  for (const key of keys) if (Object.hasOwn(inputs, key)) return inputs[key];
  return inputFromGoal(spec.goal, actionSpace.byOperation.TYPE_TEXT);
}

function safeTraceAction(candidate) {
  return candidate ? {
    id: candidate.id,
    operation: candidate.operation,
    role: candidate.role,
    label: candidate.label,
  } : null;
}

export async function loadSpec(filename) {
  const content = await fs.readFile(filename, "utf8");
  const spec = JSON.parse(content);
  if (!spec.url || !spec.goal) throw new Error("Spec requires url and goal");
  return spec;
}

export class E2ERunner {
  constructor({ spec, browser, decider, traceFile = null, logger = console } = {}) {
    this.spec = spec;
    this.browser = browser;
    this.decider = decider;
    this.traceFile = traceFile;
    this.logger = logger;
  }

  async run() {
    const trace = {
      name: this.spec.name ?? this.spec.goal,
      url: this.spec.url,
      goal: this.spec.goal,
      model: null,
      startedAt: new Date().toISOString(),
      status: "running",
      steps: [],
      errors: [],
      metrics: {
        jevRequests: 0,
        totalJevLatencyMs: 0,
        averageJevLatencyMs: 0,
      },
    };
    const maxSteps = this.spec.maxSteps ?? 30;
    const confidenceThreshold = this.spec.confidenceThreshold ?? 0.45;
    const history = [];
    let state;

    try {
      await this.browser.open(this.spec.url);
      for (let step = 0; step < maxSteps; step += 1) {
        state = await this.browser.observe();
        const actionSpace = buildActionSpace(state.snapshot, { maxCandidates: this.spec.maxCandidates ?? 120 });
        const decision = await this.decider.decide({
          goal: this.spec.goal,
          page: state,
          actionSpace,
          history,
          redactions: [
            ...Object.values(this.spec.inputs ?? {}),
            ...extractGoalValues(this.spec.goal),
          ],
        });
        trace.model = decision.model;
        if (decision.model !== "offline-script" && Number.isFinite(decision.latencyMs)) {
          trace.metrics.jevRequests += 1;
          trace.metrics.totalJevLatencyMs += decision.latencyMs;
          trace.metrics.averageJevLatencyMs = Math.round(trace.metrics.totalJevLatencyMs / trace.metrics.jevRequests);
        }

        const stepTrace = {
          step: step + 1,
          page: {
            url: state.url,
            title: state.title,
            text: redactText(state.text.slice(0, 1000), [
              ...Object.values(this.spec.inputs ?? {}),
              ...extractGoalValues(this.spec.goal),
            ]),
          },
          actionCount: actionSpace.candidates.length,
          omittedActions: actionSpace.omitted,
          operation: decision.operation,
          actionId: decision.actionId,
          confidence: decision.confidence,
          operationProbabilities: decision.operationProbabilities,
          targetProbabilities: decision.targetProbabilities,
          jevLatencyMs: decision.latencyMs ?? null,
          jevAttempts: decision.attempts ?? null,
          jevUsage: decision.usage ?? {},
          status: "decided",
        };

        if (decision.confidence < confidenceThreshold && !["DONE", "BLOCKED"].includes(decision.operation)) {
          stepTrace.status = "review";
          trace.steps.push(stepTrace);
          trace.status = "review";
          trace.errors.push({ step: step + 1, error: `Confidence ${decision.confidence.toFixed(3)} is below ${confidenceThreshold}` });
          break;
        }

        if (decision.operation === "DONE") {
          const result = await evaluateAssertions(this.browser, state, this.spec.assertions);
          stepTrace.status = result.passed ? "passed" : "failed";
          stepTrace.assertions = result;
          trace.steps.push(stepTrace);
          trace.status = result.passed ? "passed" : "failed";
          if (!result.passed) trace.errors.push(...result.failures.map((failure) => ({ step: step + 1, ...failure })));
          break;
        }

        if (decision.operation === "BLOCKED") {
          stepTrace.status = "blocked";
          trace.steps.push(stepTrace);
          trace.status = "blocked";
          trace.errors.push({ step: step + 1, error: "Jev reported no supported action can make progress" });
          break;
        }

        const candidate = candidateById(actionSpace, decision.actionId, decision.operation);
        if (!candidate || candidate.operation !== decision.operation) {
          stepTrace.status = "invalid_decision";
          trace.steps.push(stepTrace);
          trace.status = "failed";
          trace.errors.push({ step: step + 1, error: "Decision did not identify a current compatible action" });
          break;
        }

        stepTrace.action = safeTraceAction(candidate);
        try {
          await this.browser.execute(candidate, inputFor(this.spec, candidate, actionSpace));
          stepTrace.status = "executed";
          history.push({ operation: candidate.operation, actionId: candidate.id, label: candidate.label, status: "executed" });
        } catch (error) {
          stepTrace.status = "execution_failed";
          stepTrace.error = error.message;
          trace.steps.push(stepTrace);
          trace.status = "failed";
          trace.errors.push({ step: step + 1, error: error.message });
          break;
        }
        trace.steps.push(stepTrace);
      }
      if (trace.status === "running") {
        trace.status = "failed";
        trace.errors.push({ error: `Reached maxSteps=${maxSteps} without DONE` });
      }
    } catch (error) {
      trace.status = "failed";
      trace.errors.push({ error: error.message });
    } finally {
      trace.finishedAt = new Date().toISOString();
      await this.browser.close();
      if (this.traceFile) {
        await fs.mkdir(path.dirname(this.traceFile), { recursive: true });
        await fs.writeFile(this.traceFile, `${JSON.stringify(trace, null, 2)}\n`);
      }
    }

    this.logger.log(`E2E ${trace.status}: ${trace.name}`);
    if (trace.errors.length) this.logger.log(trace.errors.map((item) => `- ${item.error}`).join("\n"));
    return trace;
  }
}

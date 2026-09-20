const NUMERIC_VALUE_PATTERN = /\b\d{2,}\b/g;

/**
 * Find explicit multi-digit literals in the trusted test goal without adding
 * a structured value list to the external Jev request.
 */
export function extractGoalValues(goal) {
  const values = [];
  for (const match of String(goal ?? "").matchAll(NUMERIC_VALUE_PATTERN)) {
    if (!values.includes(match[0])) values.push(match[0]);
  }
  return values;
}

/**
 * Use a goal value only when the current page exposes exactly one editable
 * target and the goal contains exactly one unambiguous multi-digit value.
 */
export function inputFromGoal(goal, editableCandidates = []) {
  const values = extractGoalValues(goal);
  return editableCandidates.length === 1 && values.length === 1 ? values[0] : undefined;
}

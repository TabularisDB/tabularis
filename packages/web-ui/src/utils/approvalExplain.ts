import type { ExplainPlan, ExplainQueryOutput } from "@tabularis/explain";
import { resolveExplainOutput } from "@tabularis/explain";

/**
 * Normalise the `explainPlan` payload of a pending MCP approval into an
 * `ExplainPlan`, or `null` when there is nothing renderable.
 *
 * The MCP preflight stores the driver's `ExplainQueryOutput` verbatim
 * ({kind: "raw"|"plan", ...}) — parsing into an `ExplainPlan` happens
 * client-side, same as the Editor's explain modal. Casting the payload
 * straight to `ExplainPlan` crashes the visualiser on `plan.root`.
 */
export function parseApprovalExplainPlan(value: unknown): ExplainPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  try {
    const plan =
      "kind" in value
        ? resolveExplainOutput(value as ExplainQueryOutput)
        : (value as ExplainPlan);
    // A plan without a root would crash the visualiser downstream.
    return plan?.root ? plan : null;
  } catch {
    return null;
  }
}

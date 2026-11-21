import { EVALUATE_CLONE_RUN_OPERATION } from "../../domain/cloneRun/cloneRunSchemas.js";
import { readEvidenceFileSource } from "../analysisView/evidenceFileSource.js";
import { parseCaptureEvidence } from "../environment/environmentSource.js";

/**
 * The failure text a capture recorded for one of its steps, for the worklist
 * item of a step that did not complete.
 * Contract: docs/reference/clone-runs.md, "Who a comparison finding goes to".
 *
 * The file is authenticated and parsed by the capture owners again, so the
 * text is the capture's own and never an edited copy. It decides nothing: a
 * file that cannot be read gives no text, and the item then says so.
 */
export const readCloneRunStepFailure = async (
  file: string,
  stepId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<string | undefined> => {
  const evidence = await readEvidenceFileSource(file, options, undefined, {
    operation: EVALUATE_CLONE_RUN_OPERATION,
    path: ["capture"],
  });
  if (!evidence.ok) return undefined;
  const parsed = parseCaptureEvidence(
    EVALUATE_CLONE_RUN_OPERATION,
    evidence.value,
  );
  if (!parsed.ok) return undefined;
  const step = parsed.value.scenario?.steps.find(
    (entry) => entry.step_id === stepId,
  );
  return step?.status === "failed" ? step.error : undefined;
};

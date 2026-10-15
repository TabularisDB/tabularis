import { UI_STATE_KEYS, uiStateStore } from "./uiStateStore";

export const SUPPORT_PROMPT_DISMISSED_KEY = UI_STATE_KEYS.supportPromptDismissed.key;

export function isSupportPromptDismissed(): boolean {
  return uiStateStore.get<unknown>(SUPPORT_PROMPT_DISMISSED_KEY, false) === true;
}

/** Persist before notifying subscribers, so a failed write does not hide the prompt. */
export function dismissSupportPrompt(): Promise<void> {
  return uiStateStore.commit(SUPPORT_PROMPT_DISMISSED_KEY, true);
}

/**
 * Keep both modal instances in sync. The shared store also follows
 * `ui-state://changed`, so other windows and browser sessions update too.
 */
export function subscribeToSupportPrompt(onChange: () => void): () => void {
  return uiStateStore.subscribe(onChange);
}

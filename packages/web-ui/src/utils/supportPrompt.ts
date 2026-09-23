export const SUPPORT_PROMPT_DISMISSED_KEY = "tabularis_support_prompt_dismissed";
const SUPPORT_PROMPT_CHANGED_EVENT = "tabularis-support-prompt-changed";

export function isSupportPromptDismissed(): boolean {
  try {
    return localStorage.getItem(SUPPORT_PROMPT_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

/** Persist before notifying subscribers, so a failed write does not hide the prompt. */
export function dismissSupportPrompt(): void {
  localStorage.setItem(SUPPORT_PROMPT_DISMISSED_KEY, "true");
  window.dispatchEvent(new Event(SUPPORT_PROMPT_CHANGED_EVENT));
}

/** Keep both modal instances and other app windows in sync. */
export function subscribeToSupportPrompt(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SUPPORT_PROMPT_DISMISSED_KEY) {
      onChange();
    }
  };
  window.addEventListener(SUPPORT_PROMPT_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SUPPORT_PROMPT_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

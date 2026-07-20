import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "../utils/errors";
import {
  validateK8sPath,
  type K8sCommandOptions,
  type K8sPathValidationKind,
} from "../utils/k8s";
import { useLatestAsync } from "./useLatestAsync";

export type K8sPathValidationStatus =
  | "idle"
  | "validating"
  | "valid"
  | "error";

export interface K8sPathValidationState {
  status: K8sPathValidationStatus;
  error?: string;
}

export type K8sPathValidationResult =
  | { status: "valid" }
  | { status: "invalid"; error: string }
  | { status: "stale" };

export type K8sPathEnsureAppliedResult =
  | { status: "ready"; options: K8sCommandOptions }
  | { status: "invalid" }
  | { status: "applied"; options: K8sCommandOptions };

interface K8sPathDrafts {
  kubectl: string;
  kubeconfig: string;
}

interface K8sPathValidationStates {
  kubectl: K8sPathValidationState;
  kubeconfig: K8sPathValidationState;
}

interface PendingValidation {
  value: string;
  promise: Promise<K8sPathValidationResult>;
}

export interface UseK8sPathOverridesOptions {
  onApplied?: (options: K8sCommandOptions) => void;
  onDraftChanged?: () => void;
}

export interface K8sPathOverrides {
  kubectlPath: string;
  kubeconfigPath: string;
  appliedOptions: K8sCommandOptions;
  kubectlValidation: K8sPathValidationState;
  kubeconfigValidation: K8sPathValidationState;
  hasChanges: boolean;
  setPath: (kind: K8sPathValidationKind, value: string) => void;
  validatePath: (
    kind: K8sPathValidationKind,
  ) => Promise<K8sPathValidationResult>;
  ensureApplied: () => Promise<K8sPathEnsureAppliedResult>;
  cancelPending: () => void;
  initialize: (options?: K8sCommandOptions) => void;
  reset: (options?: K8sCommandOptions) => void;
}

const pathKinds: K8sPathValidationKind[] = ["kubectl", "kubeconfig"];

function normalizePath(path: string | undefined): string | undefined {
  const normalized = path?.trim();
  return normalized || undefined;
}

function toCommandOptions(drafts: K8sPathDrafts): K8sCommandOptions {
  return {
    kubectl_path: normalizePath(drafts.kubectl),
    kubeconfig_path: normalizePath(drafts.kubeconfig),
  };
}

function toDrafts(options?: K8sCommandOptions): K8sPathDrafts {
  return {
    kubectl: normalizePath(options?.kubectl_path) ?? "",
    kubeconfig: normalizePath(options?.kubeconfig_path) ?? "",
  };
}

function optionsEqual(
  left: K8sCommandOptions,
  right: K8sCommandOptions,
): boolean {
  return (
    left.kubectl_path === right.kubectl_path &&
    left.kubeconfig_path === right.kubeconfig_path
  );
}

function emptyValidationStates(): K8sPathValidationStates {
  return {
    kubectl: { status: "idle" },
    kubeconfig: { status: "idle" },
  };
}

function validationKey(kind: K8sPathValidationKind): string {
  return `k8s-path:${kind}`;
}

/**
 * Owns draft and applied kubectl/kubeconfig path overrides. Validation uses
 * latest-only requests, while current refs make concurrent field blurs apply
 * the final pair exactly once.
 */
export function useK8sPathOverrides(
  options: UseK8sPathOverridesOptions = {},
): K8sPathOverrides {
  const { onApplied, onDraftChanged } = options;
  const { invalidate, run } = useLatestAsync();
  const [drafts, setDrafts] = useState<K8sPathDrafts>(() => toDrafts());
  const [appliedOptions, setAppliedOptions] = useState<K8sCommandOptions>({});
  const [validations, setValidations] = useState<K8sPathValidationStates>(
    emptyValidationStates,
  );
  const draftsRef = useRef<K8sPathDrafts>({ kubectl: "", kubeconfig: "" });
  const appliedOptionsRef = useRef<K8sCommandOptions>({});
  const validationsRef = useRef<K8sPathValidationStates>(
    emptyValidationStates(),
  );
  const pendingRef = useRef<
    Partial<Record<K8sPathValidationKind, PendingValidation>>
  >({});
  const applySuspensionRef = useRef(0);
  const operationVersionRef = useRef(0);
  const onAppliedRef = useRef(onApplied);
  const onDraftChangedRef = useRef(onDraftChanged);

  useEffect(() => {
    onAppliedRef.current = onApplied;
    onDraftChangedRef.current = onDraftChanged;
  }, [onApplied, onDraftChanged]);

  const cancelPending = useCallback(() => {
    const cancellationVersion = ++operationVersionRef.current;
    applySuspensionRef.current = 0;
    pathKinds.forEach((kind) => {
      invalidate(validationKey(kind));
    });
    pendingRef.current = {};

    const nextValidations = emptyValidationStates();
    validationsRef.current = nextValidations;
    queueMicrotask(() => {
      if (
        operationVersionRef.current === cancellationVersion &&
        validationsRef.current === nextValidations
      ) {
        setValidations(nextValidations);
      }
    });
  }, [invalidate]);

  const setValidation = useCallback(
    (kind: K8sPathValidationKind, validation: K8sPathValidationState) => {
      const next = { ...validationsRef.current, [kind]: validation };
      validationsRef.current = next;
      setValidations(next);
    },
    [],
  );

  const canApplyCurrentDrafts = useCallback((): boolean => {
    const candidate = toCommandOptions(draftsRef.current);

    return pathKinds.every((kind) => {
      const optionKey = `${kind}_path` as const;
      const candidatePath = candidate[optionKey];
      return (
        candidatePath === undefined ||
        validationsRef.current[kind].status === "valid"
      );
    });
  }, []);

  const applyCurrentDrafts = useCallback(
    (ignoreSuspension = false): K8sCommandOptions | null => {
      const candidate = toCommandOptions(draftsRef.current);
      if (
        (!ignoreSuspension && applySuspensionRef.current > 0) ||
        optionsEqual(candidate, appliedOptionsRef.current) ||
        !canApplyCurrentDrafts()
      ) {
        return null;
      }

      appliedOptionsRef.current = candidate;
      setAppliedOptions(candidate);
      onAppliedRef.current?.(candidate);
      return candidate;
    },
    [canApplyCurrentDrafts],
  );

  const setPath = useCallback(
    (kind: K8sPathValidationKind, value: string) => {
      if (draftsRef.current[kind] === value) return;

      onDraftChangedRef.current?.();
      operationVersionRef.current += 1;
      applySuspensionRef.current = 0;
      invalidate(validationKey(kind));
      delete pendingRef.current[kind];
      const next = { ...draftsRef.current, [kind]: value };
      draftsRef.current = next;
      setDrafts(next);
      setValidation(kind, { status: "idle" });
    },
    [invalidate, setValidation],
  );

  const validatePath = useCallback(
    (kind: K8sPathValidationKind): Promise<K8sPathValidationResult> => {
      const value = draftsRef.current[kind];
      const path = normalizePath(value);

      if (!path) {
        invalidate(validationKey(kind));
        delete pendingRef.current[kind];
        setValidation(kind, { status: "idle" });
        applyCurrentDrafts();
        return Promise.resolve({ status: "valid" });
      }

      const pending = pendingRef.current[kind];
      if (pending?.value === value) {
        return pending.promise;
      }

      setValidation(kind, { status: "validating" });
      const promise = (async (): Promise<K8sPathValidationResult> => {
        const result = await run(validationKey(kind), () =>
          validateK8sPath(path, kind),
        );

        if (result.status === "stale" || draftsRef.current[kind] !== value) {
          return { status: "stale" };
        }

        if (result.status === "error") {
          const error = toErrorMessage(result.error);
          setValidation(kind, { status: "error", error });
          return { status: "invalid", error };
        }

        setValidation(kind, { status: "valid" });
        applyCurrentDrafts();
        return { status: "valid" };
      })();
      pendingRef.current[kind] = { value, promise };

      void promise.finally(() => {
        if (pendingRef.current[kind]?.promise === promise) {
          delete pendingRef.current[kind];
        }
      });

      return promise;
    },
    [applyCurrentDrafts, invalidate, run, setValidation],
  );

  const initialize = useCallback(
    (nextOptions: K8sCommandOptions = {}) => {
      cancelPending();

      const nextAppliedOptions = toCommandOptions(toDrafts(nextOptions));
      const nextDrafts = toDrafts(nextAppliedOptions);
      const nextValidations = emptyValidationStates();
      draftsRef.current = nextDrafts;
      appliedOptionsRef.current = nextAppliedOptions;
      validationsRef.current = nextValidations;
      setDrafts(nextDrafts);
      setAppliedOptions(nextAppliedOptions);
      setValidations(nextValidations);
    },
    [cancelPending],
  );

  const reset = useCallback(
    (nextOptions: K8sCommandOptions = {}) => {
      initialize(nextOptions);
    },
    [initialize],
  );

  const ensureApplied = useCallback(async (): Promise<K8sPathEnsureAppliedResult> => {
    const startingVersion = operationVersionRef.current;
    const startingOptions = toCommandOptions(draftsRef.current);
    const wasAlreadyApplied = optionsEqual(
      startingOptions,
      appliedOptionsRef.current,
    );

    applySuspensionRef.current += 1;
    let results: K8sPathValidationResult[];
    try {
      results = await Promise.all(
        pathKinds.map((kind) => {
          const optionKey = `${kind}_path` as const;
          const candidatePath = startingOptions[optionKey];

          if (
            candidatePath === undefined ||
            validationsRef.current[kind].status === "valid"
          ) {
            return Promise.resolve<K8sPathValidationResult>({
              status: "valid",
            });
          }

          return validatePath(kind);
        }),
      );
    } finally {
      if (operationVersionRef.current === startingVersion) {
        applySuspensionRef.current -= 1;
      }
    }

    const currentOptions = toCommandOptions(draftsRef.current);
    if (
      operationVersionRef.current !== startingVersion ||
      !optionsEqual(currentOptions, startingOptions) ||
      results.some((result) => result.status !== "valid")
    ) {
      return { status: "invalid" };
    }

    if (wasAlreadyApplied) {
      return { status: "ready", options: currentOptions };
    }

    if (!canApplyCurrentDrafts()) {
      return { status: "invalid" };
    }

    const applied = applyCurrentDrafts(true);
    return applied
      ? { status: "applied", options: applied }
      : { status: "applied", options: currentOptions };
  }, [applyCurrentDrafts, canApplyCurrentDrafts, validatePath]);

  const hasChanges = useMemo(
    () => !optionsEqual(toCommandOptions(drafts), appliedOptions),
    [appliedOptions, drafts],
  );

  return {
    kubectlPath: drafts.kubectl,
    kubeconfigPath: drafts.kubeconfig,
    appliedOptions,
    kubectlValidation: validations.kubectl,
    kubeconfigValidation: validations.kubeconfig,
    hasChanges,
    setPath,
    validatePath,
    ensureApplied,
    cancelPending,
    initialize,
    reset,
  };
}

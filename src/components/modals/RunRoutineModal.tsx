import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, Play, Variable } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../ui/Modal";
import type { RoutineInfo } from "../../contexts/DatabaseContext";
import {
  buildRoutineCallArgs,
  isCallParameter,
  isNumericDataType,
  isOutputOnly,
  type RoutineArgInput,
  type RoutineParameterInfo,
} from "../../utils/routineCall";

interface RunRoutineModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  routine: RoutineInfo;
  schema?: string;
  /** Receives the generated invocation script, ready to execute. */
  onRun: (sql: string) => void;
}

export const RunRoutineModal = ({
  isOpen,
  onClose,
  connectionId,
  routine,
  schema,
  onRun,
}: RunRoutineModalProps) => {
  const { t } = useTranslation();
  const [parameters, setParameters] = useState<RoutineParameterInfo[]>([]);
  const [inputs, setInputs] = useState<Record<number, RoutineArgInput>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError("");
    invoke<RoutineParameterInfo[]>("get_routine_parameters", {
      connectionId,
      routineName: routine.name,
      ...(schema ? { schema } : {}),
    })
      .then((params) => {
        if (cancelled) return;
        const callParams = params.filter(isCallParameter);
        setParameters(callParams);
        const initial: Record<number, RoutineArgInput> = {};
        for (const p of callParams) {
          initial[p.ordinal_position] = {
            value: "",
            isNull: isOutputOnly(p),
            isRaw: isNumericDataType(p.data_type),
          };
        }
        setInputs(initial);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, connectionId, routine.name, schema]);

  const updateInput = useCallback(
    (position: number, partial: Partial<RoutineArgInput>) => {
      setInputs((prev) => ({
        ...prev,
        [position]: { ...prev[position], ...partial },
      }));
    },
    [],
  );

  const handleRun = async () => {
    setIsBuilding(true);
    setError("");
    try {
      const args = buildRoutineCallArgs(parameters, inputs);
      const sql = await invoke<string>("build_routine_call_sql", {
        connectionId,
        routineName: routine.name,
        routineType: routine.routine_type,
        args,
        ...(schema ? { schema } : {}),
      });
      onRun(sql);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-900/30 rounded-lg">
              <Play size={20} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("routines.runTitle", { name: routine.name })}
              </h2>
              <p className="text-xs text-secondary">
                {t("routines.runSubtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-8 text-muted">
              <Loader2 size={24} className="animate-spin mx-auto mb-2" />
              {t("routines.loadingParameters")}
            </div>
          ) : parameters.length === 0 ? (
            <div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
              <p className="text-sm text-secondary leading-relaxed">
                {t("routines.noParameters")}
              </p>
            </div>
          ) : (
            parameters.map((param, paramIdx) => {
              const input = inputs[param.ordinal_position] ?? {
                value: "",
                isNull: false,
                isRaw: false,
              };
              const outputOnly = isOutputOnly(param);
              return (
                <div key={param.ordinal_position}>
                  <label className="text-xs uppercase font-bold text-muted mb-1 flex items-center gap-2">
                    <Variable size={12} className="text-blue-400" />
                    <span>{param.name || `#${param.ordinal_position}`}</span>
                    <span className="font-mono normal-case font-normal">
                      {param.mode} {param.data_type}
                    </span>
                  </label>
                  {outputOnly ? (
                    <div className="w-full px-3 py-2 bg-base border border-default rounded-lg text-muted text-sm italic">
                      {t("routines.outputParameter")}
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={input.isNull ? "" : input.value}
                        disabled={input.isNull}
                        onChange={(e) =>
                          updateInput(param.ordinal_position, {
                            value: e.target.value,
                          })
                        }
                        className="flex-1 px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none disabled:opacity-50"
                        placeholder={param.data_type}
                        autoFocus={
                          paramIdx === parameters.findIndex((p) => !isOutputOnly(p))
                        }
                      />
                      <label className="flex items-center gap-1 text-xs text-secondary select-none">
                        <input
                          type="checkbox"
                          checked={input.isNull}
                          onChange={(e) =>
                            updateInput(param.ordinal_position, {
                              isNull: e.target.checked,
                            })
                          }
                        />
                        NULL
                      </label>
                      <label
                        className="flex items-center gap-1 text-xs text-secondary select-none"
                        title={t("routines.rawHint")}
                      >
                        <input
                          type="checkbox"
                          checked={input.isRaw}
                          onChange={(e) =>
                            updateInput(param.ordinal_position, {
                              isRaw: e.target.checked,
                            })
                          }
                        />
                        {t("routines.rawLabel")}
                      </label>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-3 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleRun}
            disabled={isLoading || isBuilding}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {isBuilding && <Loader2 size={16} className="animate-spin" />}
            {t("routines.runButton")}
          </button>
        </div>
      </div>
    </Modal>
  );
};

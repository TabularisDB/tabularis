import React, { useState } from "react";
import { X, Save, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";

interface QueryParamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  parameters: string[];
  initialValues: Record<string, string>;
  mode?: "run" | "save" | "explain";
}

export const QueryParamsModal = ({
  isOpen,
  onClose,
  onSubmit,
  parameters,
  initialValues,
  mode = "save",
}: QueryParamsModalProps) => {
  return (
    <Modal key={isOpen ? 'open' : 'closed'} isOpen={isOpen} onClose={onClose} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <QueryParamsForm
        parameters={parameters}
        initialValues={initialValues}
        onSubmit={onSubmit}
        onClose={onClose}
        mode={mode}
      />
    </Modal>
  );
};

const QueryParamsForm = ({ parameters, initialValues, onSubmit, onClose, mode }: {
  parameters: string[];
  initialValues: Record<string, string>;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
  mode: "run" | "save" | "explain";
}) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(initialValues || {});

  const handleChange = (param: string, value: string) => {
    setValues((prev) => ({ ...prev, [param]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  const isFormValid = parameters.every(
    (param) => values[param] && values[param].trim().length > 0
  );

  return (
    <div className="bg-elevated border border-strong rounded-lg shadow-xl w-[500px] flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-4 border-b border-default">
          <h2 className="text-lg font-semibold text-primary">
            {t("editor.queryParameters")}
          </h2>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {parameters.map((param) => (
              <div key={param} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-secondary font-mono">
                  :{param}
                </label>
                <input
                  type="text"
                  value={values[param] || ""}
                  onChange={(e) => handleChange(param, e.target.value)}
                  placeholder={t("editor.paramValuePlaceholder")}
                  className="bg-base border border-strong rounded px-3 py-2 text-sm text-primary focus:outline-none focus:border-blue-500 font-mono"
                  autoFocus={parameters[0] === param}
                />
              </div>
            ))}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-secondary hover:text-primary hover:bg-surface-secondary rounded transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!isFormValid}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mode === "run" || mode === "explain" ? (
                <Play size={16} fill="currentColor" />
              ) : (
                <Save size={16} fill="currentColor" />
              )}
              {mode === "explain"
                ? t("editor.visualExplain.buttonShort")
                : mode === "run"
                  ? t("editor.run")
                  : t("common.save")}
            </button>
          </div>
        </form>
      </div>
  );
};

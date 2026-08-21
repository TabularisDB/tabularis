import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X, Variable } from "lucide-react";
import type { NotebookParam } from "../../types/notebook";
import {
  validateParamName,
  createParam,
  addParam,
  updateParam,
  removeParam,
} from "../../utils/notebookParams";

interface ParamsPanelProps {
  params: NotebookParam[];
  onParamsChange: (params: NotebookParam[]) => void;
}

function ParamRow({
  param,
  onValueChange,
  onRemove,
}: {
  param: NotebookParam;
  onValueChange: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-green-400 font-mono shrink-0">
        @{param.name}
      </span>
      <span className="text-[10px] text-muted">=</span>
      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
        type="text"
        value={param.value}
        onChange={(e) => onValueChange(e.target.value)}
        className="flex-1 text-[11px] bg-surface-secondary border border-strong rounded px-1.5 py-0.5 text-primary font-mono outline-none focus:border-blue-500 min-w-0"
      />
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 text-muted hover:text-red-400 rounded transition-colors shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function AddParamForm({
  onAdd,
}: {
  onAdd: (name: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (!validateParamName(trimmedName)) {
      setError(t("editor.notebook.invalidParamName"));
      return;
    }
    onAdd(trimmedName, value);
    setName("");
    setValue("");
    setError("");
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted shrink-0">@</span>
      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError("");
        }}
        placeholder={t("editor.notebook.paramName")}
        className="w-24 text-[11px] bg-surface-secondary border border-strong rounded px-1.5 py-0.5 text-primary font-mono outline-none focus:border-blue-500"
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
      />
      <span className="text-[10px] text-muted">=</span>
      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("editor.notebook.paramValue")}
        className="flex-1 text-[11px] bg-surface-secondary border border-strong rounded px-1.5 py-0.5 text-primary font-mono outline-none focus:border-blue-500 min-w-0"
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
      />
      <button
        type="button"
        onClick={handleSubmit}
        className="p-0.5 text-muted hover:text-green-400 rounded transition-colors shrink-0"
      >
        <Plus size={12} />
      </button>
      {error && (
        <span className="text-[9px] text-red-400 absolute -bottom-3 left-0">
          {error}
        </span>
      )}
    </div>
  );
}

export function ParamsPanel({ params, onParamsChange }: ParamsPanelProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(params.length > 0);

  return (
    <div className="mx-4 mb-3">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-muted hover:text-secondary transition-colors mb-1"
      >
        <Variable size={12} />
        <span className="font-semibold uppercase">
          {t("editor.notebook.parameters")}
        </span>
        {params.length > 0 && (
          <span className="text-[9px] bg-surface-secondary rounded px-1 py-0.5">
            {params.length}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="bg-elevated border border-default rounded-lg p-2 space-y-1.5">
          {params.map((param) => (
            <ParamRow
              key={param.name}
              param={param}
              onValueChange={(value) =>
                onParamsChange(updateParam(params, param.name, value))
              }
              onRemove={() =>
                onParamsChange(removeParam(params, param.name))
              }
            />
          ))}
          <AddParamForm
            onAdd={(name, value) =>
              onParamsChange(addParam(params, createParam(name, value)))
            }
          />
        </div>
      )}
    </div>
  );
}

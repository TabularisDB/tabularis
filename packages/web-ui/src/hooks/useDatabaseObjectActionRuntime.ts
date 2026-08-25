import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { DatabaseObjectActionRuntime } from "../utils/databaseObjectActions";
import {
  loadRoutineDefinition,
  loadTriggerDefinition,
} from "../utils/databaseObjectActions";
import { openEditor } from "../utils/editorNavigation";
import { useAlert } from "./useAlert";
import { useTabularisClient } from "./useTabularisClient";

export function useDatabaseObjectActionRuntime(): DatabaseObjectActionRuntime {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showAlert } = useAlert();
  const client = useTabularisClient();

  return useMemo(
    () => ({
      navigateToEditor: (request) => openEditor(navigate, request),
      loadRoutineDefinition: (target) => loadRoutineDefinition(client, target),
      loadTriggerDefinition: (target) => loadTriggerDefinition(client, target),
      showDefinitionError: (type, error) => {
        console.error(error);
        showAlert(
          t(
            type === "routine"
              ? "sidebar.failGetRoutineDefinition"
              : "sidebar.failGetTriggerDefinition",
          ) + String(error),
          { kind: "error" },
        );
      },
    }),
    [client, navigate, showAlert, t],
  );
}

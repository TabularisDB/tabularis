import { useCallback, useMemo } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PluginInstallConfirmModal } from "../components/modals/PluginInstallConfirmModal";
import { usePluginInstallConfirmation } from "../hooks/usePluginInstallConfirmation";
import { useSettings } from "../hooks/useSettings";
import { BROWSER_ROUTES } from "../routing";
import { parsePluginInstallRoute } from "../utils/pluginInstallRoute";

/** Browser equivalent of a native tabularis://install deep link. */
export function PluginInstallRoutePage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { busy, clearError, confirm: confirmInstall, error } =
    usePluginInstallConfirmation();
  const request = useMemo(
    () => parsePluginInstallRoute(slug, searchParams),
    [searchParams, slug],
  );

  const closeRoute = useCallback(() => {
    clearError();
    navigate(BROWSER_ROUTES.connections, { replace: true });
  }, [clearError, navigate]);

  const confirm = useCallback(async () => {
    if (await confirmInstall(request)) closeRoute();
  }, [closeRoute, confirmInstall, request]);

  if (!request) {
    return <Navigate to={BROWSER_ROUTES.connections} replace />;
  }

  return (
    <PluginInstallConfirmModal
      request={request}
      busy={busy}
      error={error}
      onConfirm={() => {
        void confirm();
      }}
      onCancel={closeRoute}
      configuredRegistry={settings.tabulariumRegistryUrl ?? null}
    />
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Download,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Boxes,
  Home,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "../ui/Modal";
import type { RegistryPluginWithStatus } from "../../types/plugins";
import type { DeepLinkInstallRequest } from "../../hooks/useDeepLinkInstall";

interface PluginInstallConfirmModalProps {
  request: DeepLinkInstallRequest | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** The registry URL the user currently has configured (or the default). */
  configuredRegistry?: string | null;
}

// The backend's `fetch_tabularium_plugin_preview` returns the same shape we
// use for catalogue entries, with `releases` left empty / loose. Reuse the
// type so we get autocomplete for every Tabularium field (icon, kind, tags…).
type PluginPreview = RegistryPluginWithStatus;

/**
 * Shown when a `tabularis://install/<slug>` URL arrives via the OS deep-link
 * handler. The user must explicitly confirm — a malicious or accidental link
 * cannot trigger a silent install.
 *
 * On mount we fetch the rich plugin record from the registry so the modal
 * shows the actual display name, icon, description, kind, tags etc. — not
 * just the raw slug. If the fetch fails (offline, plugin removed, hostile
 * registry) we degrade gracefully to a minimal view that still lets the user
 * cancel or proceed with eyes open.
 */
export const PluginInstallConfirmModal = ({
  request,
  busy,
  error,
  onConfirm,
  onCancel,
  configuredRegistry,
}: PluginInstallConfirmModalProps) => {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  // Starts true for an active request: the modal is keyed by request in App.tsx,
  // so each new request remounts this component with fresh state — no synchronous
  // reset in the effect needed (which would trigger cascading renders).
  const [previewLoading, setPreviewLoading] = useState(() => Boolean(request));
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Fetch the preview for this request. State is only updated from the async
  // callbacks below; the initial empty/loading state comes from the keyed remount.
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    invoke<PluginPreview>("fetch_tabularium_plugin_preview", {
      slug: request.slug,
      registryUrl: request.registry ?? null,
      // `?version=` in the deep link yields "" — treat it as "no pin".
      version: request.version || null,
    })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(String(err));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!request) return null;

  const requestedRegistry = request.registry ?? null;
  const showsRegistryMismatch =
    !!requestedRegistry &&
    !!configuredRegistry &&
    stripSlash(requestedRegistry) !== stripSlash(configuredRegistry);

  const base = stripSlash(
    preview?.registry_base_url ?? requestedRegistry ?? configuredRegistry ?? "",
  );
  const pluginPageUrl = base ? `${base}/plugins/${request.slug}` : null;
  const targetVersion =
    (request.version || null) ?? preview?.latest_version ?? null;

  const action = preview?.install_action ?? "install";
  const isUpToDate = action === "up_to_date";
  const isUpdate = action === "update";

  // Release-integrity signature (distinct from the admin `verified` flag). An
  // `invalid` signature blocks the install — a valid signature over a tampered
  // or wrong release is exactly the attack the check exists to stop.
  const signature = preview?.signature ?? null;
  const signatureInvalid = signature === "invalid";

  const displayName = preview?.name ?? request.slug;
  const description = preview?.description ?? null;
  const author = preview?.author ?? null;
  const kind = preview?.kind ?? null;
  const tags = (preview?.tags ?? []).filter((tag) => tag !== kind);
  const icon = preview?.icon ?? null;
  const homepage = preview?.homepage ?? null;
  const homepageDistinct =
    !!homepage && (!pluginPageUrl || stripSlash(homepage) !== stripSlash(pluginPageUrl));

  return (
    <Modal isOpen onClose={onCancel}>
      <div className="bg-elevated border border-strong rounded-2xl shadow-2xl w-[560px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-default bg-base">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <Download size={18} className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-primary">
                {t("deepLink.installTitle")}
              </h2>
              <p className="text-xs text-secondary">
                {t("deepLink.installSubtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-secondary hover:text-primary transition-colors shrink-0 cursor-pointer"
            disabled={busy}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Hero: icon + name + version */}
          <div className="flex items-start gap-4">
            <PluginIcon icon={icon} fallbackName={displayName} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {pluginPageUrl ? (
                  <button
                    type="button"
                    onClick={() => openUrl(pluginPageUrl)}
                    title={pluginPageUrl}
                    className="inline-flex min-w-0 items-center gap-1 text-left text-base font-semibold text-primary cursor-pointer hover:underline underline-offset-4 decoration-blue-500/60"
                  >
                    <span className="truncate">{displayName}</span>
                    <ExternalLink size={12} className="shrink-0 text-muted" />
                  </button>
                ) : (
                  <span className="block truncate text-base font-semibold text-primary">
                    {displayName}
                  </span>
                )}
                {homepageDistinct && homepage && (
                  <button
                    type="button"
                    onClick={() => openUrl(homepage)}
                    title={homepage}
                    aria-label={t("settings.plugins.openHomepage", {
                      defaultValue: "Open homepage",
                    })}
                    className="text-muted hover:text-primary cursor-pointer transition-colors"
                  >
                    <Home size={12} />
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted font-mono truncate">
                {request.slug}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-md border border-blue-700/30 bg-blue-900/20 px-1.5 py-px text-blue-300 font-medium">
                  v{targetVersion ?? "—"}
                </span>
                {kind && (
                  <span className="rounded-md border border-blue-700/30 bg-blue-900/20 px-1.5 py-px text-blue-300">
                    {kind}
                  </span>
                )}
                {tags.slice(0, 5).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-default bg-base px-1.5 py-px text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Description */}
          {description && (
            <p className="text-xs leading-relaxed text-secondary">
              {description}
            </p>
          )}

          {/* Author + previewLoading hint */}
          {(author || previewLoading) && (
            <div className="flex items-center justify-between text-[11px] text-muted">
              {author ? (
                <span>
                  {t("settings.plugins.by")}{" "}
                  <span className="text-secondary">{author}</span>
                </span>
              ) : (
                <span />
              )}
              {previewLoading && (
                <span className="inline-flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" />
                  {t("deepLink.loadingPreview", {
                    defaultValue: "Loading details…",
                  })}
                </span>
              )}
            </div>
          )}

          {/* Source registry strip */}
          <div className="flex items-center justify-between rounded-lg border border-default bg-base/60 px-3 py-2 text-[11px]">
            <span className="text-muted uppercase tracking-wider">
              {t("deepLink.registry")}
            </span>
            {requestedRegistry ? (
              <button
                type="button"
                onClick={() => openUrl(requestedRegistry)}
                title={requestedRegistry}
                className="inline-flex items-center gap-1 font-mono text-primary cursor-pointer hover:underline underline-offset-2 truncate ml-2"
              >
                <span className="truncate">{requestedRegistry}</span>
                <ExternalLink size={11} className="shrink-0 text-muted" />
              </button>
            ) : (
              <span className="text-secondary italic">
                {t("deepLink.usingConfigured", {
                  defaultValue: "using configured registry",
                })}
              </span>
            )}
          </div>

          {/* Banners */}
          <SignatureBanner status={signature} loading={previewLoading} t={t} />
          {showsRegistryMismatch && (
            <Banner tone="amber" icon={<AlertTriangle size={13} />}>
              <p className="font-medium mb-0.5">
                {t("deepLink.mismatchTitle")}
              </p>
              <p>
                {t("deepLink.mismatchBody", {
                  configured: configuredRegistry,
                })}
              </p>
            </Banner>
          )}
          {previewError && (
            <Banner tone="red" icon={<AlertTriangle size={13} />}>
              <pre className="font-mono whitespace-pre-wrap break-all text-[11px]">
                {previewError}
              </pre>
            </Banner>
          )}
          {error && (
            <Banner tone="red" icon={<AlertTriangle size={13} />}>
              <pre className="font-mono whitespace-pre-wrap break-all text-[11px]">
                {error}
              </pre>
            </Banner>
          )}
          {isUpToDate && (
            <Banner tone="amber" icon={<CheckCircle2 size={13} />}>
              <p className="font-medium">
                {t("deepLink.alreadyInstalled", {
                  version: preview?.installed_version ?? targetVersion ?? "",
                  defaultValue: "Version {{version}} is already installed.",
                })}
              </p>
            </Banner>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-default bg-base/50 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm text-secondary hover:text-primary rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            {t("common.cancel")}
          </button>
          {!isUpToDate && (
            <button
              onClick={onConfirm}
              disabled={busy || signatureInvalid}
              title={
                signatureInvalid
                  ? t("deepLink.signatureInvalidTitle", {
                      defaultValue: "Blocked: the release signature is invalid",
                    })
                  : undefined
              }
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t("deepLink.installing")}
                </>
              ) : isUpdate ? (
                <>
                  <Download size={14} />
                  {t("deepLink.updateConfirm", {
                    version: targetVersion ?? "",
                    defaultValue: "Update to v{{version}}",
                  })}
                </>
              ) : (
                <>
                  <Download size={14} />
                  {t("deepLink.installConfirm")}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

function stripSlash(s: string): string {
  return s.replace(/\/+$/, "").toLowerCase();
}

/**
 * Release-integrity signature badge. Renders nothing until the preview resolves
 * (so we don't flash "unsigned" before the probe returns). `invalid` is the one
 * that also disables the install button in the footer.
 */
function SignatureBanner({
  status,
  loading,
  t,
}: {
  status: "verified" | "unsigned" | "invalid" | "unknown" | null;
  loading: boolean;
  t: (key: string, opts?: { defaultValue: string }) => string;
}) {
  if (loading || !status) return null;

  switch (status) {
    case "verified":
      return (
        <Banner tone="green" icon={<ShieldCheck size={13} />}>
          <p className="font-medium">
            {t("deepLink.signatureVerified", {
              defaultValue:
                "Signature verified — the release's asset hashes are signed by the author.",
            })}
          </p>
        </Banner>
      );
    case "invalid":
      return (
        <Banner tone="red" icon={<ShieldAlert size={13} />}>
          <p className="font-medium mb-0.5">
            {t("deepLink.signatureInvalidTitle", {
              defaultValue: "Signature invalid",
            })}
          </p>
          <p>
            {t("deepLink.signatureInvalidBody", {
              defaultValue:
                "This release failed signature verification and cannot be installed.",
            })}
          </p>
        </Banner>
      );
    case "unsigned":
      return (
        <Banner tone="amber" icon={<ShieldAlert size={13} />}>
          <p>
            {t("deepLink.signatureUnsigned", {
              defaultValue:
                "Unsigned release — the download hash is not cryptographically signed. Install only from a source you trust.",
            })}
          </p>
        </Banner>
      );
    case "unknown":
      return (
        <Banner tone="neutral" icon={<ShieldQuestion size={13} />}>
          <p>
            {t("deepLink.signatureUnknown", {
              defaultValue:
                "Couldn't verify the release signature (registry unreachable).",
            })}
          </p>
        </Banner>
      );
  }
}

/** Square plugin logo or a deterministic letter fallback. */
function PluginIcon({
  icon,
  fallbackName,
}: {
  icon: string | null;
  fallbackName: string;
}) {
  const letter = fallbackName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="relative h-14 w-14 shrink-0 rounded-xl border border-default bg-base/60 flex items-center justify-center overflow-hidden">
      {icon ? (
        <img
          src={icon}
          alt=""
          loading="lazy"
          className="h-11 w-11 object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <Boxes size={22} className="text-muted" />
      )}
      {/* Always render the letter behind the image — visible if the image
          fails to load and onError hides it. */}
      {!icon && (
        <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-secondary/40 pointer-events-none">
          {letter}
        </span>
      )}
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "amber" | "red" | "green" | "neutral";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls = {
    amber: "bg-amber-900/20 border-amber-700/40 text-amber-300",
    red: "bg-red-900/20 border-red-700/40 text-red-300",
    green: "bg-emerald-900/20 border-emerald-700/40 text-emerald-300",
    neutral: "bg-base border-default text-secondary",
  }[tone];
  return (
    <div className={`rounded-lg border p-3 flex gap-2 text-xs ${cls}`}>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

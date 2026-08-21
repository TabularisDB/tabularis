import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Library, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import {
  getOpenSourceLibraryTotal,
  getOpenSourceLibraryUrl,
  OPEN_SOURCE_LIBRARY_SECTIONS,
} from "../../utils/openSourceLibraries";

interface OpenSourceLibrariesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OpenSourceLibrariesModal({
  isOpen,
  onClose,
}: OpenSourceLibrariesModalProps) {
  const { t } = useTranslation();
  const totalLibraries = getOpenSourceLibraryTotal();

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[760px] max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <Library size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("settings.openSourceLibraries")}
              </h2>
              <p className="text-xs text-secondary">
                {t("settings.openSourceLibrariesTotal", {
                  count: totalLibraries,
                })}
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

        <div className="p-6 space-y-6 overflow-y-auto">
          <div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
            <p className="text-sm text-secondary leading-relaxed">
              {t("settings.openSourceLibrariesDesc")}
            </p>
            <p className="text-xs text-muted mt-2">
              {t("settings.openSourceLibrariesSource")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {OPEN_SOURCE_LIBRARY_SECTIONS.map((section) => (
              <section
                key={section.id}
                className="border border-default rounded-xl overflow-hidden bg-base/40"
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-default bg-base">
                  <div>
                    <h3 className="text-sm font-semibold text-primary">
                      {t(`settings.openSourceLibrariesSections.${section.id}`)}
                    </h3>
                    <p className="text-xs text-secondary">
                      {t(
                        `settings.openSourceLibrariesEcosystem.${section.ecosystem}`,
                      )}
                    </p>
                  </div>
                  <div className="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-secondary text-secondary border border-default">
                    {section.libraries.length}
                  </div>
                </div>

                <div className="divide-y divide-default">
                  {section.libraries.map((library) => (
                    <div
                      key={`${section.id}-${library.name}`}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-primary font-medium break-all">
                          {library.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono text-secondary bg-surface-secondary px-2 py-1 rounded-md border border-default">
                          {library.version}
                        </span>
                        <button
                          onClick={() =>
                            openUrl(
                              getOpenSourceLibraryUrl(
                                section.ecosystem,
                                library.name,
                              ),
                            )
                          }
                          className="p-2 text-secondary hover:text-blue-400 hover:bg-surface-secondary rounded-lg transition-colors"
                          title={t("settings.openSourceLibrariesOpenProject")}
                          aria-label={t(
                            "settings.openSourceLibrariesOpenProject",
                          )}
                        >
                          <ExternalLink size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-default bg-base/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

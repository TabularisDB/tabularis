import clsx from "clsx";
import { Search, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { filterCatalogue, type EngineGroup, type ParadigmFacet } from "../../../utils/connectionCatalogue";
import { EngineCard } from "./EngineCard";

interface ConnectionCatalogueProps {
  groups: EngineGroup[];
  facets: ParadigmFacet[];
  loading: boolean;
  registryOffline: boolean;
  onSelect: (group: EngineGroup) => void;
}

function sectionLabel(key: string): string {
  if (key === "sql") return "SQL";
  if (key === "nosql") return "NoSQL";
  if (key === "key-value") return "Key-Value";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function ConnectionCatalogue({
  groups,
  facets,
  loading,
  registryOffline,
  onSelect,
}: ConnectionCatalogueProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedParadigms, setSelectedParadigms] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [installedOnly, setInstalledOnly] = useState(false);

  const visible = useMemo(
    () => filterCatalogue(groups, { search, paradigms: selectedParadigms, verifiedOnly, installedOnly }),
    [groups, search, selectedParadigms, verifiedOnly, installedOnly],
  );

  const bySection = useMemo(() => {
    const map = new Map<string, EngineGroup[]>();
    for (const g of visible) {
      const list = map.get(g.primaryParadigm) ?? [];
      list.push(g);
      map.set(g.primaryParadigm, list);
    }
    return [...map.entries()];
  }, [visible]);

  const toggleParadigm = (key: string) =>
    setSelectedParadigms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );

  const hasFilters =
    search.length > 0 || selectedParadigms.length > 0 || verifiedOnly || installedOnly;

  const clearFilters = () => {
    setSearch("");
    setSelectedParadigms([]);
    setVerifiedOnly(false);
    setInstalledOnly(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* ── sticky header: search + filters ── */}
      <div className="shrink-0 border-b border-default bg-base/60 px-5 pb-3 pt-4 backdrop-blur">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("connectionCatalogue.searchPlaceholder", { defaultValue: "Search databases…" })}
            className="w-full rounded-lg border border-default bg-surface-secondary py-2.5 pl-9 pr-9 text-sm text-primary outline-none transition-colors focus:border-blue-500 focus:bg-base"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={t("connectionCatalogue.clearSearch", { defaultValue: "Clear search" })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted hover:text-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {facets.map((f) => {
            const active = selectedParadigms.includes(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggleParadigm(f.key)}
                className={clsx(
                  "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-blue-500 bg-blue-500/15 text-blue-400"
                    : "border-default text-secondary hover:border-blue-500/40 hover:text-primary",
                )}
              >
                {f.label}
                <span className={clsx("ml-1", active ? "text-blue-400/70" : "text-muted")}>{f.count}</span>
              </button>
            );
          })}

          <span className="mx-0.5 h-4 w-px bg-default" />

          <button
            type="button"
            onClick={() => setVerifiedOnly((v) => !v)}
            className={clsx(
              "flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              verifiedOnly
                ? "border-blue-500 bg-blue-500/15 text-blue-400"
                : "border-default text-secondary hover:text-primary",
            )}
          >
            <ShieldCheck size={12} /> {t("connectionCatalogue.verified", { defaultValue: "Verified" })}
          </button>
          <button
            type="button"
            onClick={() => setInstalledOnly((v) => !v)}
            className={clsx(
              "flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              installedOnly
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-400"
                : "border-default text-secondary hover:text-primary",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" /> {t("connectionCatalogue.installed", { defaultValue: "Installed" })}
          </button>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto cursor-pointer text-xs text-muted hover:text-primary"
            >
              {t("connectionCatalogue.clear", { defaultValue: "Clear" })}
            </button>
          )}
        </div>
      </div>

      {/* ── scrollable results ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {registryOffline && (
          <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            {t("connectionCatalogue.registryOffline", {
              defaultValue: "Registry unreachable — showing installed and built-in drivers only.",
            })}
          </p>
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[68px] animate-pulse rounded-xl border border-default bg-surface-secondary" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Search size={28} className="text-muted/50" />
            <p className="text-sm text-muted">
              {t("connectionCatalogue.noMatches", { defaultValue: "No databases match your filters." })}
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="cursor-pointer text-xs font-medium text-blue-400 hover:text-blue-300"
              >
                {t("connectionCatalogue.clearFilters", { defaultValue: "Clear filters" })}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {bySection.map(([paradigm, list]) => (
              <section key={paradigm} className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted/70">
                  {sectionLabel(paradigm)}
                  <span className="rounded bg-surface px-1.5 py-px text-[10px] font-semibold text-muted">
                    {list.length}
                  </span>
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((g) => (
                    <EngineCard key={g.engine} group={g} onSelect={onSelect} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

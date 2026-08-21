import { useEffect, useState } from "react";
import { type ChangelogEntry, parseChangelog } from "../utils/changelog";
import { versionLinks } from "../data/changelog";
import { GITHUB_URL } from "../config/links";

const CHANGELOG_RAW_URL = `${GITHUB_URL.replace("github.com", "raw.githubusercontent.com")}/main/CHANGELOG.md`;

interface UseChangelogResult {
  entries: ChangelogEntry[];
  isLoading: boolean;
  error: string | null;
}

export function useChangelog(): UseChangelogResult {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(CHANGELOG_RAW_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((md) => {
        if (!cancelled) {
          setEntries(parseChangelog(md, versionLinks));
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, isLoading, error };
}

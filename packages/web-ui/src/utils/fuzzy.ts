import Fuse from "fuse.js";

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  const trimmed = query.trim();
  if (trimmed === "") return items;

  const texts = items.map(getText);
  const fuse = new Fuse(texts, {
    threshold: 0.4,
    ignoreLocation: true,
  });

  return fuse.search(trimmed).map((result) => items[result.refIndex]);
}

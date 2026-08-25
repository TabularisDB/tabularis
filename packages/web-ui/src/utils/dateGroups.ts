const DAY_MS = 86_400_000;

type Ymd = { y: number; m: number; d: number };

/** Resolve an IANA name (treating undefined/"auto" as OS local). */
function resolveZone(timeZone?: string): string | undefined {
  return timeZone && timeZone !== "auto" ? timeZone : undefined;
}

/** Calendar year/month/day of an instant *as seen in the given timezone*. */
function zonedYmd(date: Date, zone: string | undefined): Ymd {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: zone }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(date);
  }
  const get = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Timezone-independent, day-granular comparable number for a calendar day. */
function ymdToNum({ y, m, d }: Ymd): number {
  return Date.UTC(y, m - 1, d);
}

/**
 * Groups items by date category: Today, Yesterday, This Week, This Month, Older.
 * Returns an array of [groupKey, items[]] tuples in chronological group order.
 * `timeZone` is an optional IANA name (e.g. "Asia/Tokyo"); when omitted, "auto",
 * or unrecognised, the OS local timezone is used. The "today/yesterday/…"
 * boundaries are computed in the same zone the labels are rendered in, so the
 * grouping and the per-row time stay consistent across day boundaries.
 */
export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => string,
  timeZone?: string,
): [string, T[]][] {
  const zone = resolveZone(timeZone);
  const today = zonedYmd(new Date(), zone);
  const todayNum = ymdToNum(today);
  const yesterdayNum = todayNum - DAY_MS;
  const weekAgoNum = todayNum - 7 * DAY_MS;
  // One calendar month back in the display zone (Date.UTC normalises underflow).
  const monthAgoNum = ymdToNum({ y: today.y, m: today.m - 1, d: today.d });

  const groups = new Map<string, T[]>();
  const order = [
    "dateGroupToday",
    "dateGroupYesterday",
    "dateGroupThisWeek",
    "dateGroupThisMonth",
    "dateGroupOlder",
  ];

  for (const key of order) {
    groups.set(key, []);
  }

  for (const item of items) {
    const date = new Date(getDate(item));
    const itemNum = Number.isNaN(date.getTime())
      ? Number.NEGATIVE_INFINITY
      : ymdToNum(zonedYmd(date, zone));

    let groupKey: string;
    if (itemNum >= todayNum) {
      groupKey = "dateGroupToday";
    } else if (itemNum >= yesterdayNum) {
      groupKey = "dateGroupYesterday";
    } else if (itemNum >= weekAgoNum) {
      groupKey = "dateGroupThisWeek";
    } else if (itemNum >= monthAgoNum) {
      groupKey = "dateGroupThisMonth";
    } else {
      groupKey = "dateGroupOlder";
    }

    groups.get(groupKey)!.push(item);
  }

  // Return only non-empty groups
  return order
    .filter((key) => groups.get(key)!.length > 0)
    .map((key) => [key, groups.get(key)!]);
}

/**
 * Formats a timestamp for display in the history sidebar.
 * Today: "HH:mm", otherwise: "MMM DD".
 * `timeZone` is an optional IANA name (e.g. "Asia/Tokyo"); when omitted, "auto",
 * or unrecognised, the OS local timezone is used. The "is it today?" check is
 * computed in the same zone used for rendering.
 */
export function formatHistoryTime(isoDate: string, timeZone?: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  const zone = resolveZone(timeZone);
  const isToday = ymdToNum(zonedYmd(date, zone)) >= ymdToNum(zonedYmd(new Date(), zone));

  try {
    if (isToday) {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: zone,
      });
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: zone,
    });
  } catch {
    // Unrecognised IANA name — fall back to the OS local timezone.
    return isToday
      ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}

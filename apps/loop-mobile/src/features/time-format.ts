/**
 * Time captions for the conversation surface (decision
 * 2026-xx-codex-detail-checklist C6). Pure formatters over RFC 3339
 * `occurredAt` strings — consumed at render time, never copied into
 * projection state (D4 §8).
 */

/** `09:41`-style local clock caption for a timeline row. */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Compact relative time for chat-list rows: `5m` / `2h` / `3d`, and the
 * local date string once the distance exceeds a week. Negative or
 * unparseable input degrades to the clock (never a crash, never a lie).
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const deltaMs = now.getTime() - date.getTime();
  if (deltaMs < 0) return clockTime(iso); // future-skewed clock: show the clock honestly
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** Local-midnight timestamp used for calendar-day comparison. */
function localMidnightMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Korean relative time for session rows (session-title naming rule,
 * operator-approved): `방금` / `N분 전` / `N시간 전` / `어제` / a date.
 * Boundaries are fixed and deterministic: under a minute → 방금, under an
 * hour → N분 전, under 24 hours → N시간 전, the previous LOCAL calendar
 * day → 어제, otherwise the date (the year is shown once it differs from
 * `now`'s). Future-skewed or unparseable input degrades to an empty
 * string — never a crash, never a fabricated time.
 */
export function relativeTimeKo(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const deltaMs = now.getTime() - date.getTime();
  if (deltaMs < 0) return ""; // future-skewed clock: no honest relative caption
  if (deltaMs < 60_000) return "방금";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  // Calendar-day comparison in LOCAL time: exactly one day back is 어제,
  // anything older is a date.
  const dayMs = 24 * 60 * 60_000;
  const dayDiff = Math.round((localMidnightMs(now) - localMidnightMs(date)) / dayMs);
  if (dayDiff === 1) return "어제";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (date.getFullYear() !== now.getFullYear()) {
    return `${date.getFullYear()}년 ${month}월 ${day}일`;
  }
  return `${month}월 ${day}일`;
}

/** Local calendar day key (`2026-09-25`) used to place date headers. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Centered date-section header label (`Sep 25`). */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

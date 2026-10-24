import type { DateTimeElement } from "./types";

/**
 * Date patterns use these tokens; anything else is printed as is.
 *   YYYY 2026   YY 26
 *   MMMM October   MMM Oct   MM 10   M 10
 *   DD 04   D 4
 *   dddd Saturday   ddd Sat
 */
const TOKENS = /YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g;

export const DATE_PRESETS: { pattern: string; label?: string }[] = [
  { pattern: "locale", label: "System format" },
  { pattern: "YYYY-MM-DD" },
  { pattern: "DD/MM/YYYY" },
  { pattern: "MM/DD/YYYY" },
  { pattern: "DD.MM.YYYY" },
  { pattern: "D MMM YYYY" },
  { pattern: "MMM D, YYYY" },
  { pattern: "D MMM" },
  { pattern: "DD/MM" },
  { pattern: "ddd D MMM" },
  { pattern: "dddd, D MMMM YYYY" },
  { pattern: "", label: "No date" },
];

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(date: Date, pattern: string, locale?: string): string {
  if (pattern === "locale") return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  const name = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, opts).format(date);
  return pattern.replace(TOKENS, (t) => {
    switch (t) {
      case "YYYY": return String(date.getFullYear());
      case "YY": return pad(date.getFullYear() % 100);
      case "MMMM": return name({ month: "long" });
      case "MMM": return name({ month: "short" });
      case "MM": return pad(date.getMonth() + 1);
      case "M": return String(date.getMonth() + 1);
      case "DD": return pad(date.getDate());
      case "D": return String(date.getDate());
      case "dddd": return name({ weekday: "long" });
      case "ddd": return name({ weekday: "short" });
      default: return t;
    }
  });
}

/** Hours and minutes; seconds are never printed. */
export function formatTime(date: Date, hour12: boolean): string {
  const m = pad(date.getMinutes());
  if (!hour12) return `${pad(date.getHours())}:${m}`;
  const h = date.getHours() % 12 || 12;
  return `${h}:${m} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

/** The text a date/time element prints at `now`. */
export function dateTimeText(el: Pick<DateTimeElement, "dateFormat" | "showTime" | "hour12" | "prefix" | "offsetDays">, now: Date): string {
  const date = new Date(now);
  date.setDate(date.getDate() + el.offsetDays);
  const parts = [el.dateFormat ? formatDate(date, el.dateFormat) : "", el.showTime ? formatTime(now, el.hour12) : ""].filter(Boolean);
  return `${el.prefix}${parts.join(" ")}`;
}

/** Whether this computer shows 12-hour time by default. */
export function systemUses12Hour(): boolean {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h11" || cycle === "h12";
}

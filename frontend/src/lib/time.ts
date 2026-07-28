// Display timezone helpers. Data stays in UTC; these format for display only.
import { TickMarkType, type Time } from "lightweight-charts";

export const TZ_OPTIONS: { label: string; min: number }[] = [
  { label: "UTC", min: 0 },
  { label: "UTC+1", min: 60 },
  { label: "UTC+2", min: 120 },
  { label: "UTC+3", min: 180 },
  { label: "UTC+5:30", min: 330 },
  { label: "UTC+8", min: 480 },
  { label: "UTC+9", min: 540 },
  { label: "UTC-4", min: -240 },
  { label: "UTC-5", min: -300 },
  { label: "UTC-8", min: -480 },
];

export function tzLabel(min: number): string {
  const opt = TZ_OPTIONS.find((t) => t.min === min);
  if (opt) return opt.label;
  const sign = min >= 0 ? "+" : "-";
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  return `UTC${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Parse an ISO string as UTC (append Z when it has no offset), shift by the
// display offset, and read via getUTC* so the parts are already in that zone.
function shifted(iso: string, min: number): Date {
  const base = Date.parse(/[Z+]/.test(iso) ? iso : iso + "Z");
  return new Date(base + min * 60000);
}

/** A real instant (e.g. "as of") — always shown in the chosen zone. */
export function fmtInstant(iso: string, min: number): string {
  const d = shifted(iso, min);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** A bar timestamp: daily bars (00:00 UTC) are day markers, shown date-only and
 *  timezone-agnostic; intraday bars are shifted to the chosen zone. */
export function fmtBarTime(iso: string | null, min: number): string {
  if (!iso) return "—";
  const utcTime = iso.slice(11, 16);
  if (utcTime === "" || utcTime === "00:00") return iso.slice(0, 10);
  return fmtInstant(iso, min);
}

// --- lightweight-charts formatters (time is a UTCTimestamp in seconds) --------
const asDate = (time: Time, min: number) => new Date((time as number) * 1000 + min * 60000);

export function chartLocalization(min: number) {
  return {
    timeFormatter: (time: Time) => {
      const d = asDate(time, min);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    },
  };
}

export function chartTickFormatter(min: number) {
  return (time: Time, tickType: TickMarkType): string => {
    const d = asDate(time, min);
    switch (tickType) {
      case TickMarkType.Year:
        return String(d.getUTCFullYear());
      case TickMarkType.Month:
        return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      case TickMarkType.DayOfMonth:
        return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
      default:
        return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
  };
}

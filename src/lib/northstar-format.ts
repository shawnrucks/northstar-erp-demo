export type NorthstarDateValue = Date | string | number | null | undefined;

const northstarDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
const northstarDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

/**
 * Converts database date values into a plain, transport-safe YYYY-MM-DD value.
 * PostgreSQL can return DATE columns as Date objects while SQLite returns text.
 */
export function serializeNorthstarDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (dateOnly) return dateOnly;
  }

  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Formats a Northstar date consistently without applying the browser's timezone. */
export function formatNorthstarDate(value: NorthstarDateValue, fallback = "—") {
  const serialized = serializeNorthstarDate(value);
  if (!serialized) return fallback;
  return northstarDateFormatter.format(new Date(`${serialized}T00:00:00.000Z`));
}

/** Formats a timestamp consistently for operational and audit history. */
export function formatNorthstarDateTime(value: NorthstarDateValue, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : northstarDateTimeFormatter.format(date);
}

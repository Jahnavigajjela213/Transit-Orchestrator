export const words = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "");
export const sentence = (s: string | null | undefined) => { const w = words(s); return w ? w[0].toUpperCase() + w.slice(1) : ""; };

/** All times are shown in the agency's zone (US Eastern), whatever zone the browser is in.
 *  The API sends naive Eastern wall-clock times; a string with an offset (e.g. "Z") is converted to Eastern. */
export const AGENCY_TZ = "America/New_York";
const toEastern = (x: Date) => new Date(x.toLocaleString("en-US", { timeZone: AGENCY_TZ }));
const hasOffset = (s: string) => /(Z|[+-]\d\d:?\d\d)$/.test(s);
const d = (s: string) => (hasOffset(s) ? toEastern(new Date(s)) : new Date(s));
/** The current Eastern wall-clock time, comparable with times parsed from the API. */
export const easternNow = () => toEastern(new Date());
export const time = (s?: string | null) => (s ? d(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
export const dayTime = (s?: string | null) =>
  s ? d(s).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const seconds = (s?: string | null) => (s ? d(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

export function ago(s?: string | null): string {
  if (!s) return "—";
  const diff = (easternNow().getTime() - d(s).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

export function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 16);
}

export const clockET = () => easternNow().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const roleName: Record<string, string> = {
  dispatcher: "Dispatcher", shop_manager: "Shop manager", admin: "Operations admin", viewer: "Analyst",
};

const kinds: Record<string, string> = { eta_update: "ETA update", vehicle_change: "Vehicle change", correction: "Correction", booking_confirmed: "Standby booking" };
export const workflowName: Record<string, string> = { vehicle_health: "Vehicle Health to Service Continuity", no_show_recovery: "No-Show Recovery" };
export const modeName: Record<string, string> = { insert: "Book a standby rider", resequence: "Move later pickups earlier", hold: "Record only, no change" };
export const kindLabel = (k: string) => kinds[k] ?? sentence(k);

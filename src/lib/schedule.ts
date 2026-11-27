export const AGENDA_ZONE = "America/Sao_Paulo";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
export const SLOT_INTERVALS = [15, 30, 60, 90, 120] as const;

export type AgendaDay = { enabled: boolean; start: string; end: string };
type SlotInterval = typeof SLOT_INTERVALS[number];
export type AgendaConfig = { days: AgendaDay[]; blockedDates: string[]; noticeHours: number; horizonDays: number; slotIntervalMinutes: SlotInterval };
export type BookingWindow = { start: number; end: number };
export type SlotDay = { date: string; label: string; times: { start: number; label: string }[] };

export const DEFAULT_AGENDA: AgendaConfig = {
  days: WEEKDAYS.map(() => ({ enabled: false, start: "09:00", end: "18:00" })),
  blockedDates: [],
  noticeHours: 2,
  horizonDays: 30,
  slotIntervalMinutes: 60,
};

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^20\d{2}-\d{2}-\d{2}$/;

export function validAgendaDate(value: string) {
  if (!datePattern.test(value)) return false;
  const date = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(date) && new Date(date).toISOString().startsWith(`${value}T`);
}

export function parseAgenda(value: unknown): AgendaConfig | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<AgendaConfig>;
  if (!Array.isArray(data.days) || data.days.length !== 7 || !Array.isArray(data.blockedDates) || data.blockedDates.length > 366) return null;
  if (!Number.isInteger(data.noticeHours) || data.noticeHours! < 0 || data.noticeHours! > 168) return null;
  if (!Number.isInteger(data.horizonDays) || data.horizonDays! < 1 || data.horizonDays! > 60) return null;
  const requestedInterval = data.slotIntervalMinutes === undefined ? DEFAULT_AGENDA.slotIntervalMinutes : data.slotIntervalMinutes;
  const slotIntervalMinutes = SLOT_INTERVALS.find(interval => interval === requestedInterval);
  if (slotIntervalMinutes === undefined) return null;
  const days: AgendaDay[] = [];
  for (const day of data.days) {
    if (!day || typeof day.enabled !== "boolean" || typeof day.start !== "string" || typeof day.end !== "string") return null;
    const validWindow = timePattern.test(day.start) && timePattern.test(day.end) && day.start < day.end;
    if (!validWindow && day.enabled) return null;
    days.push(validWindow ? { enabled: day.enabled, start: day.start, end: day.end } : { ...DEFAULT_AGENDA.days[days.length] });
  }
  if (data.blockedDates.some(date => typeof date !== "string" || !validAgendaDate(date))) return null;
  return { days, blockedDates: [...new Set(data.blockedDates)].sort(), noticeHours: data.noticeHours!, horizonDays: data.horizonDays!, slotIntervalMinutes };
}

const localParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: AGENDA_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const dayLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const timeLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: AGENDA_ZONE, hour: "2-digit", minute: "2-digit" });
const bookingLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: AGENDA_ZONE, dateStyle: "full", timeStyle: "short" });

function parts(timestamp: number) {
  const values = Object.fromEntries(localParts.formatToParts(timestamp).map(({ type, value }) => [type, value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function localInstant(date: string, time: string) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = parts(instant);
    const difference = wall - Date.parse(`${current.date}T${current.time}:00Z`);
    if (difference === 0) return instant;
    instant += difference;
  }
  return null;
}

export function activeAgenda(config: AgendaConfig) { return config.days.some(day => day.enabled); }

export function availableSlots(config: AgendaConfig, duration: number, occupied: BookingWindow[], now: number): SlotDay[] {
  const today = Date.parse(`${parts(now).date}T00:00:00Z`);
  const earliest = now + config.noticeHours * 60 * MINUTE;
  const slotStep = config.slotIntervalMinutes * MINUTE;
  const blocked = new Set(config.blockedDates);
  const groups: SlotDay[] = [];
  for (let offset = 0; offset < config.horizonDays; offset++) {
    const day = new Date(today + offset * DAY);
    const date = day.toISOString().slice(0, 10);
    const window = config.days[day.getUTCDay()];
    if (!window.enabled || blocked.has(date)) continue;
    const open = localInstant(date, window.start);
    const close = localInstant(date, window.end);
    if (open === null || close === null) continue;
    const times: SlotDay["times"] = [];
    for (let start = open; start + duration * MINUTE <= close; start += slotStep) {
      const end = start + duration * MINUTE;
      if (start >= earliest && !occupied.some(busy => start < busy.end && end > busy.start)) {
        times.push({ start, label: timeLabel.format(start) });
      }
    }
    if (times.length) groups.push({ date, label: dayLabel.format(day), times });
  }
  return groups;
}

export function formatBookingTime(start: number) { return bookingLabel.format(start); }

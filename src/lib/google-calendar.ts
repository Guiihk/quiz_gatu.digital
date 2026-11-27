import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { markGoogleSynced, readGoogleConnection, writeGoogleConnection } from "./local-store";
import { AGENDA_ZONE, type BookingWindow } from "./schedule";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_ENDPOINT = "https://www.googleapis.com/calendar/v3";
const SCOPES = ["calendar.events.owned", "calendar.events.freebusy"].map(scope => `https://www.googleapis.com/auth/${scope}`);

export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (!clientId || !secret || !redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((!local && url.protocol !== "https:") || url.pathname !== "/api/google-agenda/callback" || url.search || url.hash || url.username || url.password) return null;
    return { clientId, secret, redirectUri, origin: url.origin };
  } catch { return null; }
}

function requiredConfig() {
  const settings = googleOAuthConfig();
  if (!settings) throw new Error("Google OAuth não configurado");
  return settings;
}

export function googleAuthorization(state: string, verifier: string) {
  const settings = requiredConfig();
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: settings.clientId, redirect_uri: settings.redirectUri, response_type: "code", state,
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  }).toString();
  return url.href;
}

async function tokenRequest(parameters: Record<string, string>) {
  const settings = requiredConfig();
  const result = await fetch(TOKEN_ENDPOINT, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(8000),
    body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.secret, ...parameters }),
  });
  if (!result.ok) throw new Error("Falha na autorização Google");
  return await result.json() as { refresh_token?: string; access_token?: string; expires_in?: number; scope?: string };
}

function encryptionKey() {
  return createHash("sha256").update(`gatu-agendador:google-refresh:${requiredConfig().secret}`).digest();
}

export async function connectGoogle(code: string, verifier: string) {
  const tokens = await tokenRequest({ code, code_verifier: verifier, redirect_uri: requiredConfig().redirectUri, grant_type: "authorization_code" });
  const permissions = tokens.scope?.split(" ") ?? [];
  if (!tokens.refresh_token || !SCOPES.every(scope => permissions.includes(scope))) throw new Error("Permissões Google incompletas");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(tokens.refresh_token, "utf8"), cipher.final()]);
  const record = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  writeGoogleConnection(randomUUID(), record);
}

type GoogleConnection = NonNullable<ReturnType<typeof readGoogleConnection>>;
let cachedToken: { id: string; access: string; until: number } | undefined;

async function accessToken(connection: GoogleConnection) {
  requiredConfig();
  if (cachedToken?.id === connection.id && cachedToken.until > Date.now()) return cachedToken.access;
  const record = Buffer.from(connection.token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), record.subarray(0, 12));
  decipher.setAuthTag(record.subarray(12, 28));
  const refreshToken = Buffer.concat([decipher.update(record.subarray(28)), decipher.final()]).toString("utf8");
  const result = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  if (!result.access_token) throw new Error("Token Google indisponível");
  cachedToken = { id: connection.id, access: result.access_token, until: Date.now() + Math.max(0, (result.expires_in ?? 0) - 60) * 1000 };
  return result.access_token;
}

async function calendarRequest(connection: GoogleConnection, path: string, data?: unknown, options?: { method?: "GET" | "PATCH"; etag?: string }) {
  const token = await accessToken(connection);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (data !== undefined) headers["Content-Type"] = "application/json";
  if (options?.etag) headers["If-Match"] = options.etag;
  const response = await fetch(`${CALENDAR_ENDPOINT}${path}`, {
    method: options?.method ?? "POST", cache: "no-store", signal: AbortSignal.timeout(8000),
    headers, body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.status === 401 && cachedToken?.id === connection.id) cachedToken = undefined;
  return response;
}

export async function googleBusyTimes(connection: GoogleConnection, window: BookingWindow): Promise<BookingWindow[]> {
  const response = await calendarRequest(connection, "/freeBusy", {
    timeMin: new Date(window.start).toISOString(), timeMax: new Date(window.end).toISOString(), items: [{ id: "primary" }],
  });
  if (!response.ok) throw new Error("Google Agenda indisponível");
  const result = await response.json() as { calendars?: Record<string, { errors?: unknown[]; busy?: { start: string; end: string }[] }> };
  const calendar = Object.values(result.calendars ?? {})[0];
  if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) throw new Error("Falha na consulta Google Agenda");
  return calendar.busy.map(({ start, end }) => {
    const interval = { start: Date.parse(start), end: Date.parse(end) };
    if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.start >= interval.end) throw new Error("Horário Google inválido");
    return interval;
  });
}

type GoogleEvent = {
  etag?: string;
  status?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { email?: string }[];
};

function hasGuest(event: GoogleEvent, email: string) {
  return event.attendees?.some(attendee => attendee.email?.toLowerCase() === email.toLowerCase()) ?? false;
}

export async function syncGoogleBooking(connection: GoogleConnection, id: string, window: BookingWindow, title: string, guestEmail?: string) {
  const email = guestEmail?.trim() || "";
  const collection = "/calendars/primary/events";
  const eventId = `gatu${id.replaceAll("-", "").toLowerCase()}`;
  const eventPath = `${collection}/${eventId}`;
  const created = await calendarRequest(connection, email ? `${collection}?sendUpdates=all` : collection, {
    id: eventId,
    summary: title || "Reunião gatu.digital",
    start: { dateTime: new Date(window.start).toISOString(), timeZone: AGENDA_ZONE },
    end: { dateTime: new Date(window.end).toISOString(), timeZone: AGENDA_ZONE },
    ...(email ? { attendees: [{ email }] } : {}),
  });
  let event: GoogleEvent;
  if (created.status === 409) {
    const existing = await calendarRequest(connection, eventPath, undefined, { method: "GET" });
    if (!existing.ok) throw new Error("Não foi possível conferir o evento no Google Agenda");
    event = await existing.json() as GoogleEvent;
    if (event.status === "cancelled" || Date.parse(event.start?.dateTime ?? "") !== window.start
      || Date.parse(event.end?.dateTime ?? "") !== window.end) throw new Error("O evento foi alterado no Google Agenda");
  } else if (created.ok) {
    event = email ? await created.json() as GoogleEvent : {};
  } else {
    throw new Error("O Google Agenda não aceitou o evento");
  }

  if (email && !hasGuest(event, email)) {
    if (created.status !== 409 || !event.etag) throw new Error("O Google Agenda não registrou o convidado");
    const response = await calendarRequest(connection, `${eventPath}?sendUpdates=all`, {
      attendees: [...(event.attendees ?? []), { email }],
    }, { method: "PATCH", etag: event.etag });
    if (!response.ok || !hasGuest(await response.json() as GoogleEvent, email)) {
      throw new Error("O Google Agenda não registrou o convidado");
    }
  }
  const invited = Boolean(email);
  markGoogleSynced(id, connection.id, invited);
  return { invited };
}

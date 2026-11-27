import { generateVAPIDKeys, sendNotification } from "web-push";
import { claimPushDeliveries, deletePushSubscription, finishPushDelivery, nextPushAttempt, readPushKeys, savePushKeys } from "./local-store";
import { readPushSubscription } from "./local-store";

const CONTACT = "https://gatu.digital";
let retryTimer: { at: number; handle: ReturnType<typeof setTimeout> } | undefined;

export function safePushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.pathname === "/") return false;
    return ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname)
      || url.hostname.endsWith(".notify.windows.com") || url.hostname.endsWith(".push.apple.com");
  } catch { return false; }
}

export function parsePushSubscription(raw: unknown) {
  if (!raw || typeof raw !== "object" || !("endpoint" in raw) || !safePushEndpoint(raw.endpoint) || !("keys" in raw)) return null;
  const keys = raw.keys as { p256dh?: unknown; auth?: unknown } | null;
  if (typeof keys?.p256dh !== "string" || typeof keys.auth !== "string"
    || !/^[\w-]{87}$/.test(keys.p256dh) || !/^[\w-]{22}$/.test(keys.auth)) return null;
  const point = Buffer.from(keys.p256dh, "base64url");
  if (point.length !== 65 || point[0] !== 4 || Buffer.from(keys.auth, "base64url").length !== 16) return null;
  return { endpoint: raw.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export function ensurePushKeys() {
  return readPushKeys() ?? savePushKeys(generateVAPIDKeys());
}

export async function sendBrowserPushTest(endpoint: string) {
  if (!safePushEndpoint(endpoint)) return { error: "Inscrição do navegador inválida." };
  const keys = readPushSubscription(endpoint);
  const vapid = readPushKeys();
  if (!keys || !vapid) return { error: "Ative as notificações neste navegador novamente." };
  try {
    await sendNotification({ endpoint, keys }, JSON.stringify({ test: true }), {
      vapidDetails: { subject: CONTACT, ...vapid }, TTL: 60, urgency: "high", timeout: 8000,
    });
    return { accepted: true };
  } catch (error) {
    const code = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
    if (code === 404 || code === 410) {
      deletePushSubscription(endpoint);
      return { error: "A inscrição expirou. Ative as notificações novamente." };
    }
    return { error: code ? `O serviço de push recusou o teste (HTTP ${code}).` : "O serviço de push não respondeu ao teste." };
  }
}

function scheduleRetry(at: number) {
  if (retryTimer && retryTimer.at <= at) return;
  if (retryTimer) clearTimeout(retryTimer.handle);
  const handle = setTimeout(() => {
    retryTimer = undefined;
    void deliverBookingPush().catch(() => console.error("Falha ao processar notificações pendentes."));
  }, Math.max(0, at - Date.now()));
  handle.unref();
  retryTimer = { at, handle };
}

export async function deliverBookingPush(send = sendNotification) {
  const keys = readPushKeys();
  if (!keys) return;
  const deliveries = claimPushDeliveries(Date.now());
  await Promise.all(deliveries.map(async delivery => {
    const { id, endpoint, attempts } = delivery;
    if (!safePushEndpoint(endpoint)) {
      deletePushSubscription(endpoint);
      return;
    }
    try {
      await send({ endpoint, keys: delivery.keys }, JSON.stringify({ id }), {
        vapidDetails: { subject: CONTACT, ...keys }, TTL: 86_400, urgency: "high", timeout: 8000,
        topic: id.replaceAll("-", "").slice(0, 32),
      });
      finishPushDelivery(id, endpoint, attempts);
    } catch (error) {
      const code = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (code === 404 || code === 410) deletePushSubscription(endpoint);
      else if (attempts >= 4 || (code >= 400 && code < 500 && code !== 429)) finishPushDelivery(id, endpoint, attempts);
      else finishPushDelivery(id, endpoint, attempts, Date.now() + attempts * 30_000);
    }
  }));
  const nextAttempt = nextPushAttempt();
  if (nextAttempt !== null) scheduleRetry(nextAttempt);
}

import { createHash, randomUUID } from "node:crypto";
import { claimMetaEvents, finishMetaEvent, nextMetaEvent, readMetaSettings } from "./local-store";

const EVENT_LIMIT_MS = 7 * 86_400_000;
let retryTimer: { at: number; handle: ReturnType<typeof setTimeout> } | undefined;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function currentMetaSettings() {
  return readMetaSettings() ?? {
    pixelId: process.env.META_PIXEL_ID?.trim() ?? "",
    token: process.env.META_CONVERSIONS_ACCESS_TOKEN?.trim() ?? "",
    testCode: process.env.META_TEST_EVENT_CODE?.trim() ?? "",
    revision: 0,
  };
}

export function metaConversionsConfig() {
  const { pixelId, token, testCode } = currentMetaSettings();
  if (!/^\d{5,25}$/.test(pixelId) || !token || (process.env.NODE_ENV !== "production" && !testCode)) return null;
  const destination = sha256(JSON.stringify([pixelId, testCode || null]));
  return { pixelId, token, testCode, destination };
}

type MetaDelivery = ReturnType<typeof claimMetaEvents>[number];

function conversionEvent({ eventName, id, occurredAt, valueCents, submission }: MetaDelivery) {
  const tracking = submission.metaTracking;
  if (!tracking) return null;
  if (eventName === "Schedule" && (!tracking.clientUserAgent || !tracking.eventSourceUrl)) return null;
  if (eventName !== "Schedule" && tracking.purchaseConsent !== true) return null;
  if (eventName === "Purchase" && valueCents === undefined) return null;
  const email = submission.answers.email?.trim().toLowerCase();
  const phone = submission.answers.phone?.replace(/\D/g, "");
  return {
    event_name: eventName,
    event_time: Math.floor(occurredAt / 1000),
    event_id: `${eventName.toLowerCase()}-${id}`,
    action_source: eventName === "Schedule" ? "website" : "other",
    event_source_url: eventName === "Schedule" ? tracking.eventSourceUrl : undefined,
    custom_data: eventName === "Purchase" && valueCents !== undefined ? { value: valueCents / 100, currency: "BRL" } : undefined,
    user_data: {
      client_user_agent: tracking.clientUserAgent,
      fbp: tracking.fbp,
      fbc: tracking.fbc,
      em: email ? [sha256(email)] : undefined,
      ph: phone ? [sha256(phone.length <= 11 ? `55${phone}` : phone)] : undefined,
    },
  };
}

type MetaConfig = NonNullable<ReturnType<typeof metaConversionsConfig>>;

async function postMetaEvent(config: MetaConfig, event: Record<string, unknown>, send: typeof fetch) {
  try {
    const response = await send(`https://graph.facebook.com/v25.0/${config.pixelId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: config.token, data: [event], test_event_code: config.testCode || undefined }),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    const result = await response.json().catch(() => null);
    return {
      accepted: response.ok && result?.events_received === 1,
      status: response.status,
      code: Number.isSafeInteger(result?.error?.code) ? Number(result.error.code) : undefined,
    };
  } catch {
    return { accepted: false, status: 0 };
  }
}

export async function sendMetaConnectionTest(send = fetch) {
  const config = metaConversionsConfig();
  if (!config?.testCode) return { error: "Salve o pixel, o token e o código de teste antes de enviar." };

  const eventId = `gatu-test-${randomUUID()}`;
  const eventName = "AgendadorTesteConexao";
  const result = await postMetaEvent(config, {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "system_generated",
    opt_out: true,
    user_data: { em: [sha256(`${eventId}@example.invalid`)] },
  }, send);

  if (result.accepted) return { eventId, eventName, pixelId: config.pixelId };
  if (!result.status) return { error: "A API do Meta não respondeu. Tente novamente em instantes." };
  if (result.status === 429) return { error: "O Meta limitou os envios. Aguarde antes de testar novamente." };
  if (result.status >= 500) return { error: "A API do Meta está indisponível. Tente novamente mais tarde." };
  const code = result.code ?? result.status;
  return { error: `O Meta não confirmou o teste (código ${code}). Confira o pixel, o token e o código de teste.` };
}

async function sendConversion(config: MetaConfig, delivery: MetaDelivery, send: typeof fetch) {
  const event = conversionEvent(delivery);
  if (!event || Date.now() - delivery.occurredAt >= EVENT_LIMIT_MS || delivery.attempts > 4) return null;

  const { accepted, status } = await postMetaEvent(config, event, send);
  if (accepted) return null;
  if (status >= 400 && status < 500 && status !== 429) {
    console.warn(`Meta recusou o evento ${delivery.eventName} (HTTP ${status}).`);
    return null;
  }

  if (delivery.attempts < 4) return Date.now() + delivery.attempts * 30_000;
  console.warn(`Meta não confirmou o recebimento do evento ${delivery.eventName}.`);
  return null;
}

export async function deliverMetaConversions(send = fetch) {
  const config = metaConversionsConfig();
  if (!config) return;

  const now = Date.now();
  const deliveries = [
    ...claimMetaEvents("Schedule", config.destination, now),
    ...claimMetaEvents("InitiateCheckout", config.destination, now),
    ...claimMetaEvents("Purchase", config.destination, now),
  ];
  await Promise.all(deliveries.map(async delivery => {
    const retryAt = await sendConversion(config, delivery, send);
    finishMetaEvent(delivery.eventName, delivery.id, delivery.attempts, retryAt);
  }));
  const next = nextMetaEvent(config.destination);
  if (next !== null && retryTimer && retryTimer.at <= next) return;
  if (retryTimer) clearTimeout(retryTimer.handle);
  retryTimer = undefined;
  if (next === null) return;
  const handle = setTimeout(() => {
    retryTimer = undefined;
    void deliverMetaConversions().catch(() => console.error("Falha ao processar eventos pendentes do Meta."));
  }, Math.max(0, next - Date.now()));
  handle.unref();
  retryTimer = { at: next, handle };
}

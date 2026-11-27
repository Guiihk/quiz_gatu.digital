const CLICK_ID = /^[a-zA-Z0-9_-]{1,1024}$/;
const BROWSER_COOKIE = /^fb\.\d{1,2}\.\d{13}\.\d{1,30}$/;
const CLICK_COOKIE = /^fb\.\d{1,2}\.\d{13}\.([a-zA-Z0-9_-]{1,1024})(?:\.[a-zA-Z0-9_-]{1,128})*$/;

type MetaTrackingInput = {
  purchaseConsent?: boolean;
  fbp?: unknown;
  fbc?: unknown;
  fbclid?: unknown;
  clickSeenAt?: unknown;
  userAgent?: string | null;
  origin?: string | null;
  slug: string;
};

export type MetaTracking = {
  consentAt: number;
  purchaseConsent?: true;
  fbp?: string;
  fbc?: string;
  fbclid?: string;
  clientUserAgent?: string;
  eventSourceUrl?: string;
};

export function validMetaClickId(value: unknown): string | undefined {
  return typeof value === "string" && CLICK_ID.test(value) ? value : undefined;
}

export function buildMetaTracking(input: MetaTrackingInput, now: number): MetaTracking {
  const result: MetaTracking = { consentAt: now };
  if (input.purchaseConsent === true) result.purchaseConsent = true;
  if (typeof input.fbp === "string" && BROWSER_COOKIE.test(input.fbp)) result.fbp = input.fbp;

  const cookie = typeof input.fbc === "string" && input.fbc.length <= 1150 ? input.fbc : "";
  const cookieClick = cookie.match(CLICK_COOKIE)?.[1];
  const urlClick = validMetaClickId(input.fbclid);
  const click = urlClick ?? cookieClick;
  if (click) {
    result.fbclid = click;
    const seen = typeof input.clickSeenAt === "number" && Number.isSafeInteger(input.clickSeenAt)
      && input.clickSeenAt >= now - 90 * 86_400_000 && input.clickSeenAt <= now ? input.clickSeenAt : now;
    result.fbc = cookieClick === click ? cookie : `fb.1.${seen}.${click}`;
  }

  if (input.userAgent) result.clientUserAgent = input.userAgent.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 512);
  if (input.origin) {
    try {
      const origin = new URL(input.origin);
      if (["http:", "https:"].includes(origin.protocol) && !origin.username && !origin.password) {
        result.eventSourceUrl = new URL(`/${input.slug}`, origin.origin).href;
      }
    } catch { /* The stored attribution does not depend on a valid Origin header. */ }
  }
  return result;
}

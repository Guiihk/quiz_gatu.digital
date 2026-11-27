import type { MetaTracking } from "./meta-tracking";

export const REVENUE_OPTIONS = [
  { id: "over100", label: "Acima de R$ 100 mil por mês" },
  { id: "50to100", label: "Acima de R$ 50 mil até R$ 100 mil por mês" },
  { id: "30to50", label: "Acima de R$ 30 mil até R$ 50 mil por mês" },
  { id: "upTo30", label: "Até R$ 30 mil por mês" },
] as const;

export type Revenue = typeof REVENUE_OPTIONS[number]["id"];
export const INVESTMENT_OPTIONS = [
  { id: "yes", label: "Sim, posso investir esse valor" },
  { id: "no", label: "Neste momento, não" },
] as const;

export type Investment = typeof INVESTMENT_OPTIONS[number]["id"];
export type QuizRules = {
  revenue: Record<Revenue, "investment" | "alternative">;
  investment: Record<Investment, "schedule" | "alternative">;
};

const DEFAULT_RULES: QuizRules = {
  revenue: { over100: "investment", "50to100": "investment", "30to50": "investment", upTo30: "alternative" },
  investment: { yes: "schedule", no: "alternative" },
};

export const DESTINATION_LABELS = {
  investment: "Continuar no quiz",
  schedule: "Continuar no quiz",
  alternative: "Oferta alternativa",
};

export type Qualification = "pending" | "qualified" | "alternative";
export function qualify(revenue?: string, investment?: string, rules: QuizRules = DEFAULT_RULES): Qualification {
  const option = REVENUE_OPTIONS.find((item) => item.id === revenue);
  if (!option) return "pending";
  if (rules.revenue[option.id] === "alternative") return "alternative";
  const answer = INVESTMENT_OPTIONS.find((item) => item.id === investment);
  if (!answer) return "pending";
  return rules.investment[answer.id] === "schedule" ? "qualified" : "alternative";
}

export type QuizConfig = {
  version: 1;
  name: string;
  welcomeKicker: string;
  headline: string;
  publicSlug: string;
  ctaFontSize?: number;
  offerCtaFontSize?: number;
  subheadline: string;
  support: string;
  cta: string;
  logo: string;
  color: string;
  backgroundColor: string;
  nameTitle: string;
  nameSubtitle: string;
  phoneTitle: string;
  phoneSubtitle: string;
  instagramTitle: string;
  instagramSubtitle: string;
  revenueTitle: string;
  revenueSubtitle: string;
  investmentTitle: string;
  investmentSubtitle: string;
  rules: QuizRules;
  requiredAnswers: Record<AnswerScreen, boolean>;
  screenOrder: number[];
  customScreens: CustomScreen[];
  offerKicker: string;
  offerTitle: string;
  offerText: string;
  offerCta: string;
  offerUrl: string;
  contactConfirmationTitle: string;
  contactConfirmationMessage: string;
  bookingConfirmationTitle: string;
  bookingConfirmationMessage: string;
  duration: number;
  meetingTitle: string;
};

const BUILT_IN_SCREEN_ORDER = [0, 1, 2, 3, 4, 5];
const ANSWER_SCREENS = [1, 2, 3, 4, 5, 6] as const;
type AnswerScreen = typeof ANSWER_SCREENS[number];

export function isAnswerScreen(screen: number): screen is AnswerScreen {
  return ANSWER_SCREENS.some(id => id === screen);
}
export const SCHEDULE_SCREEN = 6;
export const OFFER_SCREEN = 7;

export type CustomScreen = {
  id: number;
  kind: "message" | "text";
  title: string;
  subtitle: string;
  required: boolean;
};

export function getScreenSequence(config: QuizConfig): number[] {
  return [...config.screenOrder, SCHEDULE_SCREEN];
}

export function getNextScreen(config: QuizConfig, screen: number, answers: { revenue: string; investment: string }): number | undefined {
  if (screen === 4 && qualify(answers.revenue, undefined, config.rules) === "alternative") return OFFER_SCREEN;
  const investment = INVESTMENT_OPTIONS.find(({ id }) => id === answers.investment);
  if (screen === 5 && investment && config.rules.investment[investment.id] === "alternative") return OFFER_SCREEN;

  const sequence = getScreenSequence(config);
  const index = sequence.indexOf(screen);
  return index < 0 ? undefined : sequence[index + 1];
}

export const ANSWER_KEYS = ["name", "phone", "instagram", "revenue", "investment", "email"] as const;
export type QuizAnswers = Record<typeof ANSWER_KEYS[number], string>;
export const BLANK_ANSWERS: QuizAnswers = { name: "", phone: "", instagram: "", revenue: "", investment: "", email: "" };

export function validateQuizScreen(config: QuizConfig, screen: number, answers: QuizAnswers, customAnswer = ""): string {
  if (isAnswerScreen(screen)) {
    const value = answers[ANSWER_KEYS[screen - 1]].trim();
    if (!value && !config.requiredAnswers[screen]) return "";
    switch (screen) {
      case 1: return value.length >= 2 ? "" : "Informe seu nome com pelo menos 2 caracteres.";
      case 2: return validPhone(value) ? "" : "Informe um telefone brasileiro válido com DDD.";
      case 3: return /^@?[a-zA-Z0-9._]{1,30}$/.test(value) ? "" : "Informe um perfil do Instagram válido.";
      case 4: return REVENUE_OPTIONS.some(item => item.id === value) ? "" : "Selecione uma faixa de faturamento.";
      case 5: return INVESTMENT_OPTIONS.some(item => item.id === value) ? "" : "Selecione uma das opções para continuar.";
      case 6: return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? "" : "Informe um e-mail válido.";
    }
  }
  const custom = config.customScreens.find(item => item.id === screen);
  return custom?.kind === "text" && custom.required && !customAnswer.trim() ? "Preencha sua resposta para continuar." : "";
}

export function reviewQuizSubmission(config: QuizConfig, raw: unknown, rawCustom: unknown) {
  if (!raw || typeof raw !== "object" || !rawCustom || typeof rawCustom !== "object") return null;
  const values = raw as Partial<Record<keyof QuizAnswers, unknown>>;
  const customValues = rawCustom as Record<number, unknown>;
  const answers = { ...BLANK_ANSWERS };
  const extra: { title: string; answer: string }[] = [];
  let screen: number | undefined = getScreenSequence(config)[0];
  while (screen !== undefined) {
    if (screen === OFFER_SCREEN) return { outcome: "alternative" as const, answers, extra };
    if (isAnswerScreen(screen)) {
      const key = ANSWER_KEYS[screen - 1];
      const value = values[key];
      if (value !== undefined && (typeof value !== "string" || value.length > (key === "email" ? 254 : 120))) return null;
      answers[key] = typeof value === "string" ? value.trim() : "";
    }
    const custom = config.customScreens.find(item => item.id === screen && item.kind === "text");
    const value = custom ? customValues[custom.id] : undefined;
    if (value !== undefined && (typeof value !== "string" || value.length > 250)) return null;
    const customAnswer = typeof value === "string" ? value.trim() : "";
    if (validateQuizScreen(config, screen, answers, customAnswer)) return null;
    if (custom && customAnswer) extra.push({ title: custom.title, answer: customAnswer });
    if (screen === SCHEDULE_SCREEN) return { outcome: "contact" as const, answers, extra };
    screen = getNextScreen(config, screen, answers);
  }
  return null;
}

const CAMPAIGN_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type CampaignSource = Partial<Record<typeof CAMPAIGN_FIELDS[number], string>>;

export function parseCampaignSource(value: unknown): CampaignSource {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const source: CampaignSource = {};
  for (const key of CAMPAIGN_FIELDS) {
    if (typeof input[key] !== "string") continue;
    const entry = input[key].trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160);
    if (entry) source[key] = entry;
  }
  return source;
}

export type QuizSubmission = NonNullable<ReturnType<typeof reviewQuizSubmission>> & { source?: CampaignSource; metaTracking?: MetaTracking };

export function quizSlug(name: string): string {
  const slug = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "");
  return !slug || ["api", "next", "favicon", "robots", "sitemap", "icon"].includes(slug)
    ? (slug ? `quiz-${slug}` : "quiz")
    : slug;
}

export const DEFAULT_CONFIG: QuizConfig = {
  version: 1,
  name: "Diagnóstico de marketing",
  welcomeKicker: "Estratégia para o seu negócio",
  headline: "O próximo passo para sua empresa crescer começa aqui.",
  publicSlug: "",
  subheadline: "Converse com a gatu.digital sobre uma estratégia de anúncios para o seu negócio.",
  support: "Responda algumas perguntas. Se houver alinhamento, você poderá escolher um horário para conversar com a gente.",
  cta: "Quero conhecer as possibilidades",
  logo: "",
  color: "#28734f",
  backgroundColor: "#ffffff",
  nameTitle: "Qual é o seu nome?",
  nameSubtitle: "Vamos começar nos conhecendo.",
  phoneTitle: "Qual é o seu WhatsApp?",
  phoneSubtitle: "Informe seu número com DDD.",
  instagramTitle: "Qual é o Instagram da sua empresa?",
  instagramSubtitle: "Assim podemos conhecer melhor o seu negócio.",
  revenueTitle: "Qual é o faturamento mensal da sua empresa?",
  revenueSubtitle: "",
  investmentTitle: "Você pode investir pelo menos R$ 2.000 por mês em anúncios?",
  investmentSubtitle: "Esse valor é destinado aos anúncios e não inclui a gestão da gatu.digital.",
  rules: DEFAULT_RULES,
  requiredAnswers: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true },
  screenOrder: BUILT_IN_SCREEN_ORDER,
  customScreens: [],
  offerKicker: "Um primeiro passo para sua empresa",
  offerTitle: "Sua empresa pode começar pelo Google.",
  offerText: "Conheça nosso serviço de estruturação e otimização do Google Meu Negócio. Uma alternativa de menor investimento para trabalhar a presença da sua empresa nas buscas locais.",
  offerCta: "Conhecer o serviço",
  offerUrl: "",
  contactConfirmationTitle: "Respostas recebidas",
  contactConfirmationMessage: "Obrigado por responder ao quiz da gatu.digital.",
  bookingConfirmationTitle: "Reunião agendada!",
  bookingConfirmationMessage: "Seu horário está confirmado. Obrigado por agendar com a gatu.digital.",
  duration: 60,
  meetingTitle: "Diagnóstico com a gatu.digital",
};

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

export const MAX_PHONE_DIGITS = 11;

export function normalizePhoneInput(value: string): string {
  return value.trimStart().replace(/^\+55/, "").replace(/\D/g, "").slice(0, MAX_PHONE_DIGITS);
}

export function readableForeground(hex: string): "#000000" | "#ffffff" {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance >= 0.179 ? "#000000" : "#ffffff";
}

export function validPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /^(?:55)?[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/.test(digits);
}

export function parseConfig(value: unknown): QuizConfig | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.version !== 1) return null;
  const result = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof QuizConfig)[]) {
    if (typeof DEFAULT_CONFIG[key] === "string" && typeof item[key] === "string") {
      Object.assign(result, { [key]: item[key] });
    }
  }
  if (!/^#[0-9a-f]{6}$/i.test(result.color)) result.color = DEFAULT_CONFIG.color;
  if (!/^#[0-9a-f]{6}$/i.test(result.backgroundColor)) result.backgroundColor = DEFAULT_CONFIG.backgroundColor;
  if (typeof item.duration === "number" && Number.isInteger(item.duration) && item.duration >= 15 && item.duration <= 240) result.duration = item.duration;
  for (const key of ["ctaFontSize", "offerCtaFontSize"] as const) {
    const size = item[key];
    if (typeof size === "number" && Number.isInteger(size) && size >= 10 && size <= 32) result[key] = size;
  }
  if (result.logo && !/^data:image\/(png|jpeg|webp);base64,/.test(result.logo)) result.logo = "";
  result.rules = parseRules(item.rules);
  result.requiredAnswers = { ...DEFAULT_CONFIG.requiredAnswers };
  if (item.requiredAnswers && typeof item.requiredAnswers === "object") {
    const savedAnswers = item.requiredAnswers as Partial<Record<AnswerScreen, unknown>>;
    for (const screen of ANSWER_SCREENS) {
      const required = savedAnswers[screen];
      if (typeof required === "boolean") result.requiredAnswers[screen] = required;
    }
  }
  const customScreens = new Map<number, CustomScreen>();
  if (Array.isArray(item.customScreens)) {
    for (const screen of item.customScreens) {
      if (!screen || !Number.isSafeInteger(screen.id) || screen.id <= OFFER_SCREEN || customScreens.has(screen.id)) continue;
      if (screen.kind !== "message" && screen.kind !== "text") continue;
      customScreens.set(screen.id, {
        id: screen.id,
        kind: screen.kind,
        title: typeof screen.title === "string" ? screen.title : "Nova tela",
        subtitle: typeof screen.subtitle === "string" ? screen.subtitle : "",
        required: screen.required === true,
      });
    }
  }
  const available = new Set([...BUILT_IN_SCREEN_ORDER, ...customScreens.keys()]);
  const savedOrder = Array.isArray(item.screenOrder) ? item.screenOrder.filter(id => available.has(id)) : [];
  result.customScreens = [...customScreens.values()];
  result.screenOrder = [...new Set([...savedOrder, ...available])];
  return result;
}

function parseRules(value: unknown): QuizRules {
  const rules = value as { revenue?: Partial<QuizRules["revenue"]>; investment?: Partial<QuizRules["investment"]> } | null;
  const revenue = { ...DEFAULT_RULES.revenue };
  const investment = { ...DEFAULT_RULES.investment };
  for (const { id } of REVENUE_OPTIONS) {
    const target = rules?.revenue?.[id];
    if (target === "investment" || target === "alternative") revenue[id] = target;
  }
  for (const { id } of INVESTMENT_OPTIONS) {
    const target = rules?.investment?.[id];
    if (target === "schedule" || target === "alternative") investment[id] = target;
  }
  return { revenue, investment };
}

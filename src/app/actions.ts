"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { createAdmin, createQuizDraft, createSession, deleteGoogleConnection, existingBooking, hasAdmin, hasSession, insertQuizResponse, loadDraft, occupiedBookings, publishDraft, readAgenda, readCrmActivity, readCrmLeads, readGoogleConnection, readPublication, readQuizPublication, recentQuizResponses, reserveBooking, reserveLoginAttempt, revokeSession, SESSION_SECONDS, upcomingBookings, verifyAdminCredentials, writeAgenda, writeCrmLead, writeDraft } from "../lib/local-store";
import { DEFAULT_CONFIG, parseCampaignSource, parseConfig, quizSlug, reviewQuizSubmission, safeExternalUrl, type QuizSubmission } from "../lib/quiz";
import { CRM_NOTE_LIMIT, isCrmStage, isDealValueCents, type CrmEdit } from "../lib/crm";
import { activeAgenda, availableSlots, DEFAULT_AGENDA, parseAgenda } from "../lib/schedule";
import { googleAuthorization, googleBusyTimes, googleOAuthConfig, syncGoogleBooking } from "../lib/google-calendar";
import { buildMetaTracking } from "../lib/meta-tracking";
import { currentMetaSettings, deliverMetaConversions, metaConversionsConfig, sendMetaConnectionTest } from "../lib/meta-conversions";
import { deleteCrmCard, deletePushSubscription, hasPushSubscription, markBookingNotificationsRead, readBookingNotifications, savePushSubscription, writeMetaSettings } from "../lib/local-store";
import { deliverBookingPush, ensurePushKeys, parsePushSubscription, safePushEndpoint, sendBrowserPushTest } from "../lib/browser-push";

const SESSION_COOKIE = "agendador_session";

export async function isSignedIn() {
  return hasSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function authenticate(_: string, form: FormData): Promise<string> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (email.length > 254 || password.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Verifique o e-mail e a senha.";
  }

  let verifiedPasswordHash;
  if (form.get("mode") === "setup") {
    if (process.env.NODE_ENV !== "development" || hasAdmin()) return "A configuração inicial está indisponível.";
    if (password.length < 12) return "Escolha uma senha com pelo menos 12 caracteres.";
    verifiedPasswordHash = await createAdmin(email, password);
    if (!verifiedPasswordHash) return "O administrador já foi criado. Recarregue a página para entrar.";
  } else {
    if (!reserveLoginAttempt()) return "Muitas tentativas de acesso. Aguarde até 15 minutos para tentar novamente.";
    verifiedPasswordHash = await verifyAdminCredentials(email, password);
    if (!verifiedPasswordHash) return "E-mail ou senha inválidos.";
  }

  const jar = await cookies();
  const session = createSession(verifiedPasswordHash);
  if (!session) return "A senha foi alterada. Entre novamente.";
  const previous = jar.get(SESSION_COOKIE)?.value;
  if (previous) revokeSession(previous);
  jar.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  redirect("/");
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) revokeSession(token);
  jar.delete(SESSION_COOKIE);
  redirect("/");
}

function validQuizId(quizId: number) {
  return Number.isSafeInteger(quizId) && quizId > 0;
}

export async function openQuizDraft(quizId: number) {
  if (!(await isSignedIn())) return { error: "Entre novamente para editar o quiz." };
  if (!validQuizId(quizId)) return { error: "Quiz inválido." };
  const draft = loadDraft(quizId);
  const config = draft ? parseConfig(JSON.parse(draft.config)) : quizId === 1 ? DEFAULT_CONFIG : null;
  if (!config) return { error: "Não foi possível abrir o quiz." };
  return { quiz: { id: quizId, config, revision: draft?.revision ?? 0, publication: readQuizPublication(quizId) } };
}

export async function createQuiz(name: string) {
  if (!(await isSignedIn())) return { error: "Entre novamente para criar um quiz." };
  if (typeof name !== "string" || !name.trim() || name.length > 120) {
    return { error: "Informe um nome de até 120 caracteres." };
  }
  const config = { ...DEFAULT_CONFIG, name: name.trim() };
  const id = createQuizDraft(JSON.stringify(config));
  return { quiz: { id, config, revision: 1, publication: null } };
}

export async function saveDraft(quizId: number, data: unknown, expectedRevision: number) {
  if (!(await isSignedIn())) return { error: "Sua sessão expirou. Entre novamente para salvar." };
  if (!validQuizId(quizId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return { error: "Versão do rascunho inválida." };
  const config = parseConfig(data);
  if (!config || !config.name.trim() || !config.headline.trim() || !config.cta.trim()) {
    return { error: "Preencha o nome, o título e o botão de abertura." };
  }
  if (config.offerUrl && !safeExternalUrl(config.offerUrl)) return { error: "Use um link HTTPS válido para a oferta alternativa." };
  const serialized = JSON.stringify(config);
  if (Buffer.byteLength(serialized) > 1_250_000) return { error: "O rascunho excedeu o tamanho permitido." };
  const revision = writeDraft(serialized, expectedRevision, quizId);
  if (revision === null) return { error: "Este rascunho foi salvo em outra aba. Abra a versão atual antes de fazer um novo salvamento." };
  return { revision, config };
}

export async function publishQuiz(quizId: number, revision: number) {
  if (!(await isSignedIn())) return { error: "Entre novamente para publicar." };
  if (!validQuizId(quizId)) return { error: "Quiz inválido." };
  const draft = loadDraft(quizId);
  if (!draft || draft.revision !== revision) return { error: "Abra e salve a versão atual do rascunho antes de publicar." };
  const config = parseConfig(JSON.parse(draft.config));
  if (!config) return { error: "Não foi possível abrir esse rascunho." };

  const publication = publishDraft(quizSlug(config.name), revision, quizId);
  if (!publication) return { error: "O rascunho mudou em outra aba. Recarregue para publicar." };
  revalidatePath(`/${publication.slug}`);
  return { publication };
}

export async function loadQuizResponses(quizId: number) {
  if (!(await isSignedIn())) return { error: "Entre novamente para consultar as respostas." };
  if (!validQuizId(quizId)) return { error: "Quiz inválido." };
  return { responses: recentQuizResponses(quizId) };
}

export async function loadCrm() {
  if (!(await isSignedIn())) return { error: "Entre novamente para acessar o CRM." };
  return { leads: readCrmLeads() };
}

export async function loadBookingNotifications() {
  if (!(await isSignedIn())) return { error: "Entre novamente para ver as notificações." };
  after(() => deliverBookingPush());
  after(() => deliverMetaConversions());
  return { feed: readBookingNotifications() };
}

export async function readBookingAlerts(id?: string) {
  if (!(await isSignedIn())) return { error: "Entre novamente para atualizar as notificações." };
  if (id !== undefined && (typeof id !== "string" || id.length > 36)) return { error: "Notificação inválida." };
  markBookingNotificationsRead(id);
  return { feed: readBookingNotifications() };
}

export async function testBrowserPush(endpoint: string) {
  if (!(await isSignedIn())) return { error: "Entre novamente para testar as notificações." };
  return sendBrowserPushTest(endpoint);
}

export async function loadPushSettings(endpoint?: string) {
  if (!(await isSignedIn())) return { error: "Entre novamente para ativar notificações." };
  return { publicKey: ensurePushKeys().publicKey, enabled: safePushEndpoint(endpoint) && hasPushSubscription(endpoint) };
}

export async function enableBrowserPush(raw: unknown) {
  if (!(await isSignedIn())) return { error: "Entre novamente para ativar notificações." };
  const subscription = parsePushSubscription(raw);
  if (!subscription) return { error: "A inscrição deste navegador não é compatível." };
  if (!savePushSubscription(subscription.endpoint, subscription.p256dh, subscription.auth)) {
    return { error: "Limite de navegadores ativados atingido." };
  }
  return { enabled: true };
}

export async function disableBrowserPush(endpoint: string) {
  if (!(await isSignedIn())) return { error: "Entre novamente para desativar notificações." };
  if (!safePushEndpoint(endpoint)) return { error: "Inscrição inválida." };
  deletePushSubscription(endpoint);
  return { enabled: false };
}

export async function loadLeadActivity(id: string) {
  if (!(await isSignedIn())) return { error: "Entre novamente para consultar o histórico." };
  if (typeof id !== "string" || id.length > 36) return { error: "Reserva inválida." };
  return { activity: readCrmActivity(id) };
}

export async function updateCrmLead(id: string, revision: number, edit: unknown) {
  if (!(await isSignedIn())) return { error: "Entre novamente para atualizar o CRM." };
  if (typeof id !== "string" || id.length > 36 || !Number.isSafeInteger(revision) || revision < 0 || !edit || typeof edit !== "object") {
    return { error: "Alteração inválida." };
  }
  let change: CrmEdit;
  if (Object.keys(edit).length !== 1) return { error: "Altere um campo por vez." };
  if ("stage" in edit && isCrmStage(edit.stage)) change = { stage: edit.stage };
  else if ("note" in edit && typeof edit.note === "string" && edit.note.length <= CRM_NOTE_LIMIT) change = { note: edit.note.trim() };
  else if ("dealValueCents" in edit && (edit.dealValueCents === null || isDealValueCents(edit.dealValueCents))) change = { dealValueCents: edit.dealValueCents };
  else return { error: "Revise o valor informado." };
  const movingToProposal = "stage" in change && change.stage === "proposal";
  const metaDestination = movingToProposal || ("stage" in change && change.stage === "won") || "dealValueCents" in change
    ? metaConversionsConfig()?.destination : undefined;
  const lead = writeCrmLead(id, revision, change, metaDestination);
  if (!lead) return { error: "O cartão mudou em outra aba. Atualize o quadro antes de salvar." };
  if (metaDestination && (lead.metaTracking?.enabledAt !== undefined || lead.metaTracking?.purchaseConsent) &&
    (movingToProposal || (lead.stage === "won" && lead.dealValueCents !== null))) {
    after(() => deliverMetaConversions());
  }
  return { lead };
}

export async function removeCrmCard(id: string, revision: number) {
  if (!(await isSignedIn())) return { error: "Entre novamente para atualizar o CRM." };
  if (typeof id !== "string" || !id || id.length > 36 || !Number.isSafeInteger(revision) || revision < 0) {
    return { error: "Cartão inválido." };
  }
  if (!deleteCrmCard(id, revision)) return { error: "O cartão mudou em outra aba. Atualize o quadro antes de excluir." };
  return { deleted: true };
}

function currentAgenda() {
  const row = readAgenda();
  const config = row ? parseAgenda(JSON.parse(row.config)) : DEFAULT_AGENDA;
  if (!config) throw new Error("Invalid stored availability");
  return { config, revision: row?.revision ?? 0 };
}

export async function loadAgenda() {
  if (!(await isSignedIn())) return { error: "Entre novamente para consultar a agenda." };
  return { agenda: currentAgenda(), bookings: upcomingBookings(Date.now(), { hideDeletedCards: true }), google: {
    configured: Boolean(googleOAuthConfig()), connected: Boolean(readGoogleConnection()),
  } };
}

function metaSettingsView() {
  const { pixelId, token, testCode, revision } = currentMetaSettings();
  const requiresTestCode = process.env.NODE_ENV !== "production";
  const ready = /^\d{5,25}$/.test(pixelId) && Boolean(token) && (!requiresTestCode || Boolean(testCode));
  return { pixelId, hasToken: Boolean(token), testCode, revision, requiresTestCode, ready };
}

export async function loadMetaIntegration() {
  if (!(await isSignedIn())) return { error: "Entre novamente para consultar a integração Meta." };
  return { settings: metaSettingsView() };
}

export async function testMetaIntegration(revision: number) {
  if (!(await isSignedIn())) return { error: "Entre novamente para testar a integração Meta." };
  if (currentMetaSettings().revision !== revision) {
    return { error: "A integração mudou em outra aba. Reabra Configurações para carregar os dados atuais." };
  }
  return sendMetaConnectionTest();
}

export async function saveMetaIntegration(revision: number, form: FormData) {
  if (!(await isSignedIn())) return { error: "Entre novamente para atualizar a integração Meta." };
  if (!Number.isSafeInteger(revision) || revision < 0 || !(form instanceof FormData)) return { error: "Configuração inválida." };
  const rawPixelId = form.get("pixelId");
  const rawToken = form.get("token");
  const rawTestCode = form.get("testCode");
  if (typeof rawPixelId !== "string" || typeof rawToken !== "string" || typeof rawTestCode !== "string") {
    return { error: "Preencha os campos da integração." };
  }
  const pixelId = rawPixelId.trim();
  const newToken = rawToken.trim();
  const testCode = rawTestCode.trim();
  if (!/^\d{5,25}$/.test(pixelId)) return { error: "Informe o ID numérico do pixel." };
  if (newToken.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(newToken)) return { error: "Confira o formato do token de acesso." };
  if (!/^[a-zA-Z0-9_-]{0,128}$/.test(testCode)) return { error: "Confira o código de teste do Gerenciador de Eventos." };

  const previous = currentMetaSettings();
  const conflict = { error: "A integração mudou em outra aba. Reabra Configurações para carregar os dados atuais." };
  if (previous.revision !== revision) return conflict;
  if (!newToken && pixelId !== previous.pixelId) return { error: "Informe um token de acesso para o novo pixel." };
  const token = newToken || previous.token;
  if (!token) return { error: "Informe o token de acesso da API de Conversões." };
  if (!writeMetaSettings({ pixelId, token, testCode }, revision)) return conflict;
  return { settings: metaSettingsView() };
}

export async function startGoogleConnection() {
  if (!(await isSignedIn()) || !googleOAuthConfig()) redirect("/?agenda=1&google=error");
  const settings = googleOAuthConfig()!;
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const jar = await cookies();
  jar.set("agenda_google_oauth", `${state}.${verifier}`, {
    httpOnly: true, sameSite: "lax", secure: settings.origin.startsWith("https:"), maxAge: 600, path: "/api/google-agenda/callback",
  });
  redirect(googleAuthorization(state, verifier));
}

export async function disconnectGoogle() {
  if (!(await isSignedIn())) return { error: "Entre novamente para desconectar o Google Agenda." };
  deleteGoogleConnection();
  return { disconnected: true };
}

export async function retryGoogleBooking(id: string) {
  if (!(await isSignedIn())) return { error: "Entre novamente para sincronizar." };
  const connection = readGoogleConnection();
  const booking = upcomingBookings(Date.now()).find(item => item.id === id);
  if (!connection || !booking) return { error: "Conecte o Google Agenda e selecione uma reunião disponível." };
  try {
    const { invited } = await syncGoogleBooking(connection, id, booking, booking.title, booking.answers.email);
    return { synced: true, invited };
  } catch { return { error: "Não foi possível sincronizar. Verifique a conexão com o Google Agenda." }; }
}

export async function saveAgenda(value: unknown, revision: number) {
  if (!(await isSignedIn())) return { error: "Entre novamente para salvar a agenda." };
  const config = parseAgenda(value);
  if (!config) return { error: "Confira os horários, as datas e os limites da agenda. O fim de cada faixa deve ser posterior ao início." };
  if (!Number.isSafeInteger(revision) || revision < 0) return { error: "Versão da agenda inválida." };
  const next = writeAgenda(JSON.stringify(config), revision);
  if (next === null) return { error: "A agenda foi alterada em outra aba. Recarregue antes de salvar." };
  return { agenda: { config, revision: next } };
}

function isQuizLink(slug: string, revision: number) {
  return typeof slug === "string" && /^[a-z0-9-]{1,70}$/.test(slug) && Number.isSafeInteger(revision);
}

export async function loadQuizSlots(slug: string, revision: number) {
  if (!isQuizLink(slug, revision)) return { error: "Link inválido." };
  const publication = readPublication(slug);
  if (!publication || publication.revision !== revision) return { error: "O quiz foi atualizado. Recarregue a página." };
  const config = parseConfig(JSON.parse(publication.config));
  if (!config) return { error: "Quiz indisponível." };
  const agenda = currentAgenda();
  const now = Date.now();
  const occupied = occupiedBookings(now);
  const days = availableSlots(agenda.config, config.duration, occupied, now);
  const connection = readGoogleConnection();
  if (!connection || !days.length) return { active: activeAgenda(agenda.config), days };
  try {
    const window = { start: days[0].times[0].start, end: days.at(-1)!.times.at(-1)!.start + config.duration * 60_000 };
    const busy = await googleBusyTimes(connection, window);
    return { active: true, days: availableSlots(agenda.config, config.duration, [...occupied, ...busy], Date.now()) };
  } catch { return { error: "O Google Agenda está indisponível. Tente consultar os horários novamente." }; }
}

export async function submitQuizResponse(slug: string, revision: number, id: string, answers: unknown, customAnswers: unknown,
  start?: number, rawSource?: unknown, tracking?: { fbclid?: string; seenAt?: number }) {
  if (!isQuizLink(slug, revision)) return { error: "Link inválido." };
  if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return { error: "Atualize a página para enviar sua resposta." };
  const existing = existingBooking(id, slug, revision);
  if (existing) {
    after(() => deliverBookingPush());
    after(() => deliverMetaConversions());
    return { outcome: "booking" as const, booking: existing };
  }
  const publication = readPublication(slug);
  if (!publication || publication.revision !== revision) return { error: "O quiz foi atualizado. Recarregue a página para responder à versão atual." };
  const config = parseConfig(JSON.parse(publication.config));
  const reviewed = config && reviewQuizSubmission(config, answers, customAnswers);
  if (!config || !reviewed) return { error: "Revise o preenchimento antes de enviar." };
  const submission = { ...reviewed, source: parseCampaignSource(rawSource) };

  if (submission.outcome === "contact") {
    const agenda = currentAgenda();
    if (activeAgenda(agenda.config)) {
      const now = Date.now();
      const days = availableSlots(agenda.config, config.duration, occupiedBookings(now), now);
      if (!Number.isSafeInteger(start) || !days.some(day => day.times.some(time => time.start === start))) {
        return { error: "O horário não está mais disponível. Escolha outro horário.", refreshSlots: true };
      }
      const window = { start: start!, end: start! + config.duration * 60_000 };
      const connection = readGoogleConnection();
      if (connection) {
        try {
          const busy = await googleBusyTimes(connection, window);
          if (busy.some(interval => interval.start < window.end && interval.end > window.start)) {
            return { error: "O horário ficou ocupado no Google Agenda. Escolha outro horário.", refreshSlots: true };
          }
        } catch { return { error: "Não foi possível consultar o Google Agenda. Tente novamente." }; }
      }
      const [jar, request] = await Promise.all([cookies(), headers()]);
      const bookingResponse: QuizSubmission = { ...submission, metaTracking: buildMetaTracking({
        fbp: jar.get("_fbp")?.value, fbc: jar.get("_fbc")?.value,
        enabledByDefault: true,
        fbclid: tracking?.fbclid, clickSeenAt: tracking?.seenAt,
        userAgent: request.get("user-agent"), origin: request.get("origin"), slug,
      }, Date.now()) };
      if (window.start < Date.now() + agenda.config.noticeHours * 3_600_000) {
        return { error: "A antecedência mínima para este horário expirou. Escolha outro horário.", refreshSlots: true };
      }
      const metaDestination = bookingResponse.metaTracking ? metaConversionsConfig()?.destination : undefined;
      const booking = reserveBooking(slug, revision, agenda.revision, id, window, config.meetingTitle,
        bookingResponse, connection?.id, metaDestination);
      if (!booking) return { error: "O horário não está mais disponível. Escolha outro horário.", refreshSlots: true };
      after(() => deliverBookingPush());
      if (metaDestination) after(() => deliverMetaConversions());
      if (connection) {
        try { await syncGoogleBooking(connection, id, booking, config.meetingTitle, submission.answers.email); }
        catch { /* The confirmed local reservation remains available for a retry in the panel. */ }
      }
      return { outcome: "booking" as const, booking };
    }
    if (start !== undefined || !insertQuizResponse(slug, revision, id, submission, agenda.revision)) {
      return { error: "A disponibilidade mudou. Confira a agenda novamente.", refreshSlots: true };
    }
    return { outcome: "contact" as const };
  }

  if (!insertQuizResponse(slug, revision, id, submission)) return { error: "O quiz foi atualizado. Recarregue a página e tente novamente." };
  return { outcome: submission.outcome };
}

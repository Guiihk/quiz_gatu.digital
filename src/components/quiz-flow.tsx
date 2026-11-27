"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CalendarBlank, Check, Clock, Globe } from "@phosphor-icons/react";
import { loadQuizSlots, submitQuizResponse } from "../app/actions";
import { BLANK_ANSWERS, DEFAULT_CONFIG, INVESTMENT_OPTIONS, OFFER_SCREEN, REVENUE_OPTIONS, SCHEDULE_SCREEN, getNextScreen, getScreenSequence, isAnswerScreen, normalizePhoneInput, readableForeground, safeExternalUrl, validateQuizScreen, type QuizAnswers, type QuizConfig } from "../lib/quiz";
import { formatBookingTime, type BookingWindow, type SlotDay } from "../lib/schedule";
import type { CampaignSource } from "../lib/quiz";
import { ExampleSlotCalendar, SlotCalendar } from "./slot-calendar";

const QUESTION_FIELDS = {
  1: { title: "nameTitle", subtitle: "nameSubtitle" },
  2: { title: "phoneTitle", subtitle: "phoneSubtitle" },
  3: { title: "instagramTitle", subtitle: "instagramSubtitle" },
  4: { title: "revenueTitle", subtitle: "revenueSubtitle" },
  5: { title: "investmentTitle", subtitle: "investmentSubtitle" },
} as const;

export function getQuestionFields(step: number) {
  return QUESTION_FIELDS[step as keyof typeof QUESTION_FIELDS];
}

export function QuizScreen({ config, step, position, interactive = false, answers = BLANK_ANSWERS, onAnswer, onNext, error = "", customAnswer = "", onCustomAnswer, publicMode = false, submitting = false, bookingEnabled = false, bookingPanel, scheduleReady = true, canSubmitSchedule = true }: {
  config: QuizConfig;
  publicMode?: boolean;
  submitting?: boolean;
  bookingEnabled?: boolean;
  bookingPanel?: ReactNode;
  scheduleReady?: boolean;
  canSubmitSchedule?: boolean;
  step: number;
  position: number;
  interactive?: boolean;
  answers?: QuizAnswers;
  onAnswer?: (key: keyof QuizAnswers, value: string) => void;
  onNext?: () => void;
  error?: string;
  customAnswer?: string;
  onCustomAnswer?: (value: string) => void;
}) {
  const customScreen = config.customScreens.find(screen => screen.id === step);
  const total = config.screenOrder.length + 1;
  const stepNumber = String(position + 1).padStart(2, "0");
  const isWelcome = step === 0;
  const answerId = useId();
  const questionFields = getQuestionFields(step);
  const required = isAnswerScreen(step) && config.requiredAnswers[step];
  const contactKey = step === 1 ? "name" : step === 2 ? "phone" : "instagram";
  const theme = {
    "--quiz-accent": config.color,
    "--quiz-accent-text": readableForeground(config.color),
    "--quiz-background": config.backgroundColor,
    "--quiz-foreground": readableForeground(config.backgroundColor),
  } as CSSProperties;

  return <div
    className={`quiz-screen ${isWelcome ? "welcome" : ""}`}
    data-custom-background={config.backgroundColor.toLowerCase() !== "#ffffff"}
    style={theme}
  >
    <div className="quiz-brand">{config.logo?<img src={config.logo} alt="Logotipo personalizado"/>:<img src="/gatu-logo.png" alt="gatu.digital" width={48} height={48}/>}</div>
    {!isWelcome && position >= 0 && (
      <div className="quiz-progress" role="progressbar" aria-label="Progresso do quiz" aria-valuemin={0} aria-valuemax={total} aria-valuenow={position + 1}>
        <span style={{ width: ((position + 1) / total * 100) + "%" }}/>
      </div>
    )}
    <form className="quiz-content" onSubmit={e=>{e.preventDefault();onNext?.();}} noValidate>
      {step===0&&<>{config.welcomeKicker.trim() && <span className="quiz-kicker uppercase">{config.welcomeKicker}</span>}<h2>{config.headline}</h2><p className="quiz-subheadline">{config.subheadline}</p><p className="quiz-support">{config.support}</p><button type="submit" className="quiz-cta" disabled={!interactive}>{config.cta}<ArrowRight size={19}/></button><span className="quiz-footnote"><Clock size={14}/>Leva poucos minutos</span></>}
      {questionFields && <>
        <span className="question-index">{stepNumber} <ArrowRight size={14}/></span>
        <h2>{config[questionFields.title].trim() || DEFAULT_CONFIG[questionFields.title]}{required && <span className="required"> *</span>}</h2>
        {config[questionFields.subtitle].trim() && <p className="question-support">{config[questionFields.subtitle]}</p>}
      </>}
      {step >= 1 && step <= 3 && <>
        <label className="sr-only" htmlFor={answerId}>
          {step === 1 ? "Nome" : step === 2 ? "WhatsApp com DDD" : "Instagram da empresa"}
        </label>
        <input
          id={answerId}
          className="quiz-input"
          type={step === 2 ? "tel" : "text"}
          autoComplete={step === 1 ? "name" : step === 2 ? "tel-national" : "off"}
          value={answers[contactKey]}
          onChange={e => onAnswer?.(contactKey, step === 2 ? normalizePhoneInput(e.target.value) : e.target.value)}
          placeholder={step === 1 ? "Digite seu nome" : step === 2 ? "DDD + número" : "@suaempresa"}
          readOnly={!interactive}
          maxLength={step === 2 ? undefined : 120}
          aria-required={required}
          aria-invalid={!!error}
        />
        <button type="submit" className="quiz-cta" disabled={!interactive}>Continuar<ArrowRight size={18}/></button>
        <span className="keyboard-hint">pressione <kbd>Enter ↵</kbd></span>
      </>}
      {step===4&&<><div className="quiz-options" role="radiogroup" aria-label="Faturamento mensal" aria-required={required}>{REVENUE_OPTIONS.map((o,i)=><label className={`quiz-option ${answers.revenue===o.id?"picked":""}`} key={o.id}><input type="radio" name="revenue" value={o.id} checked={answers.revenue===o.id} disabled={!interactive} onChange={()=>onAnswer?.("revenue",o.id)}/><span className="option-letter">{answers.revenue===o.id?<Check size={15}/>:String.fromCharCode(65+i)}</span><span>{o.label}</span></label>)}</div><button type="submit" className="quiz-cta" disabled={!interactive}>Continuar<ArrowRight size={18}/></button></>}
      {step===5&&<><div className="quiz-options" role="radiogroup" aria-label="Disponibilidade de investimento" aria-required={required}>{INVESTMENT_OPTIONS.map((o,i)=><label className={`quiz-option ${answers.investment===o.id?"picked":""}`} key={o.id}><input type="radio" name="investment" value={o.id} checked={answers.investment===o.id} disabled={!interactive} onChange={()=>onAnswer?.("investment",o.id)}/><span className="option-letter">{answers.investment===o.id?<Check size={15}/>:String.fromCharCode(65+i)}</span><span>{o.label}</span></label>)}</div><button type="submit" className="quiz-cta" disabled={!interactive}>Continuar<ArrowRight size={18}/></button></>}
      {step === 6 && <>
        <span className="question-index">{stepNumber} <ArrowRight size={14}/></span>
        <h2>{publicMode && scheduleReady && !bookingEnabled ? "Deixe seu contato" : "Escolha a melhor data para conversar."}</h2>
        {publicMode ? (
          bookingEnabled || !scheduleReady ? bookingPanel : <p className="question-support">Deixe seus dados com a gatu.digital. A escolha de horários está indisponível.</p>
        ) : (
          <>
            <div className="meeting-caption"><CalendarBlank size={20}/><strong>{config.meetingTitle}</strong><span><Clock size={15}/>{config.duration} min</span></div>
            <ExampleSlotCalendar/>
          </>
        )}
        <label className="field quiz-email">Seu e-mail{required ? " *" : " (opcional)"}
          <input type="email" maxLength={254} autoComplete="email" required={required} value={answers.email}
            readOnly={!interactive || submitting} onChange={e => onAnswer?.("email", e.target.value)} placeholder="voce@empresa.com.br"/>
        </label>
        {publicMode ? <button className="quiz-cta" type="submit" disabled={submitting || !canSubmitSchedule}>
          {submitting ? "Enviando…" : bookingEnabled ? "Confirmar agendamento" : "Enviar respostas"}<ArrowRight size={18}/></button>
          : <><p className="preview-disclaimer">Prévia de layout. Nenhuma reunião é criada.</p><button className="quiz-cta" type="button" disabled>Agendamento disponível após integração</button></>}
      </>}
      {step===7&&<><span className="alternative-symbol"><Globe size={32}/></span>{config.offerKicker.trim() && <span className="quiz-kicker uppercase">{config.offerKicker}</span>}<h2>{config.offerTitle}</h2><p className="quiz-subheadline">{config.offerText}</p>{publicMode ? <button className="quiz-cta" type="submit" disabled={submitting}>{submitting ? "Enviando…" : "Enviar respostas"}<ArrowRight size={18}/></button> : safeExternalUrl(config.offerUrl)?<a className="quiz-cta" href={safeExternalUrl(config.offerUrl)!} target="_blank" rel="noopener noreferrer" tabIndex={interactive?0:-1} onClick={e=>{if(!interactive)e.preventDefault();}}>{config.offerCta}<ArrowRight size={18}/></a>:<><button className="quiz-cta" type="button" disabled>{config.offerCta}<ArrowRight size={18}/></button><p className="preview-disclaimer">Configure o link desta oferta no editor para ativar o botão.</p></>}</>}
      {customScreen && <>
        <span className="question-index">{stepNumber} <ArrowRight size={14}/></span>
        <h2 id={answerId + "-title"}>{customScreen.title.trim() || "Nova tela"}
          {customScreen.kind === "text" && customScreen.required && <span className="required"> *</span>}
        </h2>
        {customScreen.subtitle.trim() && <p className="question-support">{customScreen.subtitle}</p>}
        {customScreen.kind === "text" && (
          <input className="quiz-input" type="text" aria-labelledby={answerId + "-title"}
            aria-required={customScreen.required} aria-invalid={!!error}
            placeholder="Digite sua resposta" maxLength={250} readOnly={!interactive}
            value={customAnswer} onChange={e => onCustomAnswer?.(e.target.value)}/>
        )}
        <button type="submit" className="quiz-cta" disabled={!interactive}>Continuar<ArrowRight size={18}/></button>
      </>}
      {error&&<p className="form-error" role="alert">{error}</p>}
    </form>

  </div>;
}

type PublicQuiz = { slug: string; revision: number; responseId: string; source: CampaignSource; click?: { fbclid: string; seenAt: number } };

export function QuizCompletion({ config, kind, preview = false, booking }: {
  config: QuizConfig;
  kind: "contact" | "booking" | "alternative";
  preview?: boolean;
  booking?: BookingWindow;
}) {
  const titleKey = kind === "booking" ? "bookingConfirmationTitle" : "contactConfirmationTitle";
  const messageKey = kind === "booking" ? "bookingConfirmationMessage" : "contactConfirmationMessage";
  const title = kind === "alternative" ? DEFAULT_CONFIG.contactConfirmationTitle : config[titleKey].trim() || DEFAULT_CONFIG[titleKey];
  const message = kind === "alternative" ? DEFAULT_CONFIG.contactConfirmationMessage : config[messageKey];
  const offerUrl = kind === "alternative" ? safeExternalUrl(config.offerUrl) : null;
  const Heading = preview ? "h2" : "h1";

  return <section className="quiz-complete" role={preview ? undefined : "status"}
    style={{ backgroundColor: config.backgroundColor, color: readableForeground(config.backgroundColor) }}>
    <Check size={30} aria-hidden="true"/>
    <Heading>{title}</Heading>
    {booking && <p><strong>{formatBookingTime(booking.start)}</strong><br/>Horário de Brasília</p>}
    {message.trim() && <p>{message}</p>}
    {offerUrl && <a className="button primary" href={offerUrl} rel="noopener noreferrer">{config.offerCta || "Conhecer a oferta"}</a>}
  </section>;
}

export function QuizFlow({ config, publication }: { config: QuizConfig; publication?: PublicQuiz }) {
  const sequence = getScreenSequence(config);
  const [step, setStep] = useState(sequence[0]);
  const [history, setHistory] = useState<number[]>([]);
  const [answers, setAnswers] = useState<QuizAnswers>({ ...BLANK_ANSWERS });
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<"contact" | "alternative" | "booking" | null>(null);
  const [booking, setBooking] = useState<BookingWindow>();
  const [slots, setSlots] = useState<{ active: boolean; days: SlotDay[] } | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [slotError, setSlotError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const slug = publication?.slug;
  const revision = publication?.revision;
  const body = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const screen = body.current;
    if (!screen) return;
    screen.scrollTop = 0;
    screen.querySelector<HTMLInputElement>(".quiz-input, .quiz-email input")?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== SCHEDULE_SCREEN || slug === undefined || revision === undefined) return;
    let current = true;
    setSlots(null);
    setSelectedSlot(null);
    setSlotError("");
    async function load() {
      try {
        const result = await loadQuizSlots(slug!, revision!);
        if (!current) return;
        if (result.days && typeof result.active === "boolean") setSlots({ active: result.active, days: result.days });
        else setSlotError(result.error || "Não foi possível consultar a agenda.");
      } catch {
        if (current) setSlotError("Não foi possível consultar a agenda.");
      }
    }
    void load();
    return () => { current = false; };
  }, [step, slug, revision, refresh]);

  async function next() {
    if (inFlight.current) return;
    const validation = validateQuizScreen(config, step, answers, customAnswers[step]);
    setError(validation);
    if (validation) return;
    if (publication && (step === SCHEDULE_SCREEN || step === OFFER_SCREEN)) {
      if (step === SCHEDULE_SCREEN && (!slots || (slots.active && selectedSlot === null))) return;
      inFlight.current = true;
      setSubmitting(true);
      try {
        const { slug, revision, responseId } = publication;
        const result = await submitQuizResponse(slug, revision, responseId, answers, customAnswers,
          step === SCHEDULE_SCREEN ? selectedSlot ?? undefined : undefined, publication.source,
          publication.click);
        if (result.outcome) {
          if (result.booking) setBooking(result.booking);
          setOutcome(result.outcome);
        } else {
          if (result.refreshSlots) setRefresh(value => value + 1);
          setError(result.error || "Não foi possível enviar. Tente novamente.");
        }
      } catch {
        setError("Não foi possível enviar. Tente novamente.");
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
      return;
    }
    const destination = getNextScreen(config, step, answers);
    if (destination === undefined) return;
    setHistory(current => [...current, step]);
    setStep(destination);
  }

  function back() {
    if (inFlight.current || !history.length) return;
    setStep(history[history.length - 1]);
    setHistory(current => current.slice(0, -1));
    setError("");
  }

  function resetTest() {
    setStep(sequence[0]);
    setHistory([]);
    setAnswers({ ...BLANK_ANSWERS });
    setCustomAnswers({});
    setError("");
  }

  if (outcome) return <QuizCompletion config={config} kind={outcome} booking={booking}/>;

  const bookingPanel = slots ? <SlotCalendar days={slots.days} value={selectedSlot} onChange={setSelectedSlot} disabled={submitting}/>
    : slotError ? <div><p className="form-error" role="alert">{slotError}</p>
      <button type="button" className="text-button" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</button>
    </div> : <p className="question-support" role="status">Buscando horários disponíveis…</p>;

  return <>
    <div ref={body} className={publication ? "public-quiz-body" : "modal-body"}>
      <QuizScreen config={config} step={step} position={sequence.indexOf(step)} interactive answers={answers}
        onAnswer={(key, value) => { setAnswers(current => ({ ...current, [key]: value })); setError(""); }}
        onNext={next} error={error} customAnswer={customAnswers[step]} publicMode={Boolean(publication)} submitting={submitting}
        bookingPanel={bookingPanel} bookingEnabled={slots?.active} scheduleReady={slots !== null}
        canSubmitSchedule={slots !== null && (!slots.active || selectedSlot !== null)}
        onCustomAnswer={value => { setCustomAnswers(current => ({ ...current, [step]: value })); setError(""); }}/>
    </div>
    <div className="modal-footer">
      <button className="text-button" disabled={!history.length || submitting} onClick={back}><ArrowLeft size={16}/>Voltar</button>
      {!publication && <button className="text-button" onClick={resetTest}>Reiniciar teste</button>}
    </div>
  </>;
}

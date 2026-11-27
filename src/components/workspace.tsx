"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarBlank, Check, CheckCircle, Clock, Eye, FileText, GearSix, GitBranch, Globe, House, Info, Kanban, List, Monitor, Plus, Rows, SlidersHorizontal, DeviceMobile, UploadSimple, Users, X } from "@phosphor-icons/react";
import { DEFAULT_CONFIG, DESTINATION_LABELS, INVESTMENT_OPTIONS, REVENUE_OPTIONS, getScreenSequence, isAnswerScreen, parseConfig, OFFER_SCREEN, type CustomScreen, type QuizConfig, type QuizRules } from "../lib/quiz";

import { createQuiz, loadQuizResponses, openQuizDraft, publishQuiz, saveDraft, signOut } from "../app/actions";
import { QuizCopyField } from "./quiz-copy";
import { quizSlug } from "../lib/quiz";

import AgendaPanel from "./agenda-panel";
import BookingNotifications from "./booking-notifications";
import CrmBoard from "./crm-board";
import MetaSettingsPanel from "./meta-settings";
import QuizLibrary, { type QuizSummary } from "./quiz-library";
import { getQuestionFields, QuizCompletion, QuizFlow, QuizScreen } from "./quiz-flow";

const STORAGE_KEY = "gatu-agendador.quiz.v1";
const CONFIRMATION_SCREEN = -1;
const CONFIRMATION_ITEM = { title: "Confirmação final", detail: "Mensagem após o envio", icon: CheckCircle };

const STEPS = [
  { title: "Boas-vindas", detail: "Apresentação", icon: House },
  { title: "Qual é o seu nome?", detail: "Texto curto", icon: Users },
  { title: "Seu WhatsApp", detail: "Telefone", icon: FileText },
  { title: "Instagram da empresa", detail: "Texto curto", icon: Globe },
  { title: "Faturamento mensal", detail: "Qualificação", icon: Rows },
  { title: "Investimento em anúncios", detail: "Qualificação", icon: Rows },
  { title: "Escolha um horário", detail: "Agendamento", icon: CalendarBlank },
  { title: "Google Meu Negócio", detail: "Oferta alternativa", icon: GitBranch },
];

type Publication = { slug: string; revision: number };
type EditableQuiz = NonNullable<Awaited<ReturnType<typeof openQuizDraft>>["quiz"]>;

export default function Workspace({ initialQuizzes, initialAgenda, googleConnectionError }: {
  initialQuizzes: QuizSummary[];
  initialAgenda: boolean;
  googleConnectionError: boolean;
}) {
  const [quizzes, setQuizzes] = useState(initialQuizzes);
  const [quizId, setQuizId] = useState<number | null>(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(DEFAULT_CONFIG);
  const [revision, setRevision] = useState(0);
  const [legacyDraft, setLegacyDraft] = useState<QuizConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [openingQuiz, setOpeningQuiz] = useState(false);
  const openingQuizRef = useRef(false);
  const savingRef = useRef(false);
  const uploadReader = useRef<FileReader | null>(null);
  const [view, setView] = useState(initialAgenda ? "Agendamentos" : "Quizzes");
  const [tab, setTab] = useState("Editor");
  const [step, setStep] = useState(0);
  const [confirmationKind, setConfirmationKind] = useState<"booking" | "contact">("booking");
  const [mobile, setMobile] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = quizId !== null && JSON.stringify(config) !== JSON.stringify(saved);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function showAgenda(event: MessageEvent) {
      if (event.data?.type === "agendador:open-bookings") setView("Agendamentos");
    }
    navigator.serviceWorker.addEventListener("message", showAgenda);
    return () => navigator.serviceWorker.removeEventListener("message", showAgenda);
  }, []);

  useEffect(() => {
    if (quizId !== 1 || revision !== 0) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setLegacyDraft(parseConfig(JSON.parse(stored)));
    } catch {
      setNotice("Não foi possível ler o rascunho anterior deste navegador.");
    }
  }, [quizId, revision]);

  useEffect(() => () => {
    if (toastRef.current) clearTimeout(toastRef.current);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function notify(message: string) {
    setNotice(message);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setNotice(""), 6000);
  }
  function change<K extends keyof QuizConfig>(key: K, value: QuizConfig[K]) { setConfig(current => ({ ...current, [key]: value })); }
  function updateQuizSummary(quiz: EditableQuiz) {
    const summary = { id: quiz.id, name: quiz.config.name, revision: quiz.revision,
      slug: quiz.publication?.slug ?? null, publishedRevision: quiz.publication?.revision ?? null };
    setQuizzes(current => current.some(item => item.id === quiz.id)
      ? current.map(item => item.id === quiz.id ? summary : item)
      : [...current, summary]);
  }

  async function enterQuiz(request: () => Promise<{ quiz?: EditableQuiz; error?: string }>) {
    if (openingQuizRef.current) return;
    openingQuizRef.current = true;
    setOpeningQuiz(true);
    try {
      const result = await request();
      if (!result.quiz) {
        notify(result.error || "Não foi possível abrir o quiz.");
        return;
      }
      const quiz = result.quiz;
      setQuizId(quiz.id);
      setConfig(quiz.config);
      setSaved(quiz.config);
      setRevision(quiz.revision);
      setPublication(quiz.publication);
      setLegacyDraft(null);
      setStep(0);
      setTab("Editor");
      setConfirmationKind("booking");
      updateQuizSummary(quiz);
    } catch {
      notify("Não foi possível abrir o quiz. Tente novamente.");
    } finally {
      openingQuizRef.current = false;
      setOpeningQuiz(false);
    }
  }

  function closeQuiz() {
    if (savingRef.current || publishing) return;
    if (dirty && !window.confirm("Voltar para a lista e descartar as alterações não salvas?")) return;
    uploadReader.current?.abort();
    setQuizId(null);
    setPreview(false);
  }

  async function save() {
    if (quizId === null || savingRef.current || publishing) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await saveDraft(quizId, config, revision);
      if ("error" in result && result.error) {
        notify(result.error);
        return;
      }
      if (result.revision === undefined || !result.config) return;
      setSaved(result.config);
      setRevision(result.revision);
      setLegacyDraft(null);
      updateQuizSummary({ id: quizId, config: result.config, revision: result.revision, publication });
      notify("Rascunho salvo no banco local.");
    } catch {
      notify("Não foi possível salvar o rascunho. Tente novamente.");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  async function publish() {
    if (quizId === null || dirty || !revision || savingRef.current || publishing) return;
    setPublishing(true);
    try {
      const result = await publishQuiz(quizId, revision);
      if (result.publication) {
        setPublication(result.publication);
        updateQuizSummary({ id: quizId, config: saved, revision, publication: result.publication });
        notify("Quiz publicado. O link já pode ser aberto neste ambiente.");
      } else notify(result.error || "Não foi possível publicar.");
    } catch {
      notify("Não foi possível publicar. Tente novamente.");
    } finally {
      setPublishing(false);
    }
  }

  async function copyQuizLink(slug: string) {
    try {
      await navigator.clipboard.writeText(new URL(`/${slug}`, window.location.origin).href);
      notify("Link copiado.");
    } catch {
      notify("Abra o quiz para copiar o endereço pela barra do navegador.");
    }
  }

  function importLegacyDraft() {
    if (!legacyDraft) return;
    setConfig(legacyDraft);
    setLegacyDraft(null);
    notify("Rascunho aberto para revisão. Clique em Salvar rascunho para gravá-lo no banco.");
  }

  async function upload(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 800_000) { notify("Envie uma imagem PNG, JPG ou WebP de até 800 KB."); return; }
    const reader = new FileReader();
    uploadReader.current?.abort();
    uploadReader.current = reader;
    reader.onloadend = () => { if (uploadReader.current === reader) uploadReader.current = null; };
    reader.onload = () => change("logo", String(reader.result));
    reader.onerror = () => notify("Não foi possível ler a imagem.");
    reader.readAsDataURL(file);
  }
  const sequence = getScreenSequence(config);
  const position = sequence.indexOf(step);
  const customScreen = config.customScreens.find(screen => screen.id === step);
  const isConfirmation = step === CONFIRMATION_SCREEN;
  const screenTitle = isConfirmation ? CONFIRMATION_ITEM.title : customScreen?.title.trim() || STEPS[step]?.title || "Nova tela";

  function addScreen(kind: CustomScreen["kind"]) {
    const id = Math.max(OFFER_SCREEN, ...config.customScreens.map(screen => screen.id)) + 1;
    const screen = {
      id, kind, title: kind === "text" ? "Nova pergunta" : "Nova tela", subtitle: "", required: false,
    };
    setConfig(current => ({
      ...current,
      customScreens: [...current.customScreens, screen],
      screenOrder: [...current.screenOrder, id],
    }));
    setStep(id);
  }

  function moveScreen(offset: -1 | 1) {
    const order = [...config.screenOrder];
    const index = order.indexOf(step);
    if (index < 0 || index + offset < 0 || index + offset >= order.length) return;
    [order[index], order[index + offset]] = [order[index + offset], order[index]];
    change("screenOrder", order);
  }

  function updateScreen(screen: CustomScreen) {
    change("customScreens", config.customScreens.map(item => item.id === screen.id ? screen : item));
  }

  function removeScreen(id: number) {
    setConfig(current => ({
      ...current,
      screenOrder: current.screenOrder.filter(screen => screen !== id),
      customScreens: current.customScreens.filter(screen => screen.id !== id),
    }));
    setStep(sequence[Math.max(0, position - 1)]);
  }

  const questionFields = getQuestionFields(step);
  const field = (key: keyof QuizConfig, label: string, multiline = false) => multiline
    ? <QuizCopyField key={key} label={label} value={String(config[key])} onChange={value => change(key, value as never)}/>
    : <label className="field" key={key}>{label}<input value={String(config[key])} onChange={e => change(key, e.target.value as never)}/></label>;

  const buttonSize = (key: "ctaFontSize" | "offerCtaFontSize") => <label className="field">Tamanho do texto do botão (px)
    <select value={config[key] ?? ""} onChange={event => change(key, Number(event.target.value) || undefined)}>
      <option value="">Padrão</option>
      {Array.from({ length: 23 }, (_, index) => index + 10).map(size => <option key={size}>{size}</option>)}
    </select>
  </label>;

  return <div className="workspace">
    <a className="skip" href="#content">Ir para o conteúdo</a>
    <aside className={`sidebar ${sidebar ? "open" : ""}`}>
      <a className="brand" href="/" aria-label="gatu.digital início"><img className="brand-mark" src="/gatu-logo.png" alt="" width={37} height={37}/><span>gatu.digital<small>Workspace</small></span></a>
      <div className="workspace-label">ESPAÇO DE TRABALHO</div>
      <div className="workspace-switch"><span className="avatar">g</span><div>gatu.digital<small>Uso interno</small></div><span className="switch-dots">···</span></div>
      <div className="nav-label">PRINCIPAL</div>
      <nav aria-label="Menu principal">{[
        { label: "Início", icon: House }, { label: "Quizzes", icon: FileText }, { label: "Agendamentos", icon: CalendarBlank }, { label: "CRM", icon: Kanban },
      ].map(item => <button key={item.label} className={`nav-item ${view === item.label ? "active" : ""}`} onClick={() => {
        if (item.label === "Quizzes" && view === "Quizzes") closeQuiz();
        setView(item.label);
        setSidebar(false);
      }}><item.icon size={19} />{item.label}{item.label === "Quizzes" && <span className="count">{quizzes.length}</span>}</button>)}</nav>
      <div className="nav-label integrations-label">GESTÃO</div>
      <button className={`nav-item ${view === "Configurações" ? "active" : ""}`} onClick={() => { setView("Configurações"); setSidebar(false); }}><GearSix size={19} />Configurações</button>
      <div className="sidebar-bottom"><span className="phase-dot" /><div>Em desenvolvimento<small>Etapa 1 · Editor do quiz</small></div></div>
      <div className="profile"><span className="avatar dark">g.</span><div>gatu.digital<small>Administrador</small></div><form action={signOut} onSubmit={event => { if (dirty && !window.confirm("Sair e descartar as alterações não salvas?")) event.preventDefault(); }}><button className="text-button" type="submit">Sair</button></form></div>
    </aside>
    {sidebar && <button className="backdrop" aria-label="Fechar menu" onClick={() => setSidebar(false)} />}
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button menu-button" aria-label="Abrir menu" onClick={() => setSidebar(true)}><List size={22} /></button><span>Workspace</span><span className="crumb-separator">/</span><strong>{view}</strong></div>
        <div className="topbar-actions"><span className="local-label"><span className="phase-dot" />Ambiente local</span>
          <BookingNotifications onOpenAgenda={() => setView("Agendamentos")}/>
        </div>
      </header>
      <main id="content">
        {view === "Quizzes" && quizId === null ? <QuizLibrary quizzes={quizzes} busy={openingQuiz}
          onOpen={id => void enterQuiz(() => openQuizDraft(id))}
          onCreate={name => void enterQuiz(() => createQuiz(name))}/>
        : view === "Quizzes" && quizId !== null ? <>
          <button type="button" className="text-button quiz-list-back" disabled={saving || publishing} onClick={closeQuiz}>
            <ArrowLeft size={16} aria-hidden="true"/> Todos os quizzes
          </button>
          <div className="page-heading"><div><div className="eyebrow">CAPTAÇÃO</div><h1>{config.name}</h1><p>Uma conversa de cada vez. Do primeiro contato à reunião.</p></div><div className="heading-actions"><span className={publication ? "badge green" : "badge"}>{publication ? "Publicado" : "Rascunho"}</span><button className="button secondary" onClick={() => setPreview(true)}><Eye size={18} />Testar quiz</button><button className="button primary" disabled={saving} onClick={save}><Check size={18} />{saving ? "Salvando…" : "Salvar rascunho"}</button></div></div>
          <section className="import-banner publication-bar" aria-label="Link do quiz">
            <div>
              <strong>{publication ? "Link do quiz" : "Endereço sugerido"}</strong>
              <label className="field">Endereço público
                <input spellCheck={false} maxLength={70} placeholder={publication?.slug ?? quizSlug(config.name)}
                  value={config.publicSlug} onChange={event => change("publicSlug", event.target.value)}/>
              </label>
              <p><code>/{config.publicSlug || publication?.slug || quizSlug(config.name)}</code></p>
              {publication && config.publicSlug && config.publicSlug !== publication.slug &&
                <small>Ao publicar, o endereço /{publication.slug} deixará de abrir este quiz.</small>}
              {(dirty || !revision) && <small>Salve o rascunho antes de publicar.</small>}
            </div>
            <div className="publication-actions">
              {publication && <>
                <a className="button secondary" href={`/${publication.slug}`} target="_blank" rel="noopener noreferrer">Abrir quiz</a>
                <button className="button secondary" onClick={() => copyQuizLink(publication.slug)}>Copiar link</button>
              </>}
              <button className="button primary" onClick={publish}
                disabled={dirty || !revision || saving || publishing || publication?.revision === revision}>
                {publishing ? "Publicando…" : publication ? "Atualizar publicação" : "Publicar quiz"}
              </button>
            </div>
          </section>
          {legacyDraft && revision === 0 && (
            <div className="import-banner">
              <p>Encontramos um rascunho salvo neste navegador.</p>
              <button className="button secondary" disabled={dirty || saving} onClick={importLegacyDraft}>Abrir rascunho anterior</button>
            </div>
          )}
          <div className="tabs" role="tablist" aria-label="Seções do quiz">{[{name:"Editor",icon:SlidersHorizontal},{name:"Regras",icon:GitBranch},{name:"Respostas",icon:Users},{name:"Configurações",icon:GearSix}].map(t => <button key={t.name} role="tab" aria-selected={tab===t.name} className={tab===t.name?"selected":""} onClick={()=>setTab(t.name)}><t.icon size={17}/>{t.name}</button>)}<span className="save-state">{dirty ? "Alterações não salvas" : revision > 0 ? "Salvo no banco local" : "Rascunho inicial"}</span></div>
          {tab === "Editor" && <div className="editor">
            <section className="step-list" aria-label="Telas do quiz">
              <div className="panel-title">Conteúdo <span>{sequence.length + 1} telas + 1 saída</span></div>
              <div className="screen-actions">
                <button className="button secondary" onClick={() => addScreen("message")}><Plus size={15}/> Tela de texto</button>
                <button className="button secondary" onClick={() => addScreen("text")}><Plus size={15}/> Pergunta</button>
              </div>
              <div className="steps">
                {[...sequence, CONFIRMATION_SCREEN, OFFER_SCREEN].map((id, index) => {
                  const custom = config.customScreens.find(screen => screen.id === id);
                  const preset = id === CONFIRMATION_SCREEN ? CONFIRMATION_ITEM : STEPS[id];
                  const title = custom ? custom.title.trim() || "Nova tela" : preset.title;
                  const detail = custom ? (custom.kind === "text" ? "Resposta curta" : "Mensagem") : preset.detail;
                  const Icon = custom ? FileText : preset.icon;
                  return (
                    <div key={id}>
                      {id === OFFER_SCREEN && <div className="end-divider">SAÍDA ALTERNATIVA</div>}
                      <button className={step === id ? "step current" : "step"} aria-pressed={step === id} onClick={() => setStep(id)}>
                        <span className="step-icon"><Icon size={17}/></span>
                        <span className="step-text"><strong>{title}</strong><small>{detail}</small></span>
                        <span className="step-number">{id === OFFER_SCREEN ? "↳" : String(index + 1).padStart(2, "0")}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flow-hint"><GitBranch size={18}/><p>A confirmação encerra o fluxo principal. A saída alternativa é acionada pelas regras.</p></div>
            </section>
            <section className="canvas-area" aria-label="Prévia da tela selecionada"><div className="canvas-toolbar"><span><span className="phase-dot"/>PRÉVIA AO VIVO</span><div className="device-switch"><button aria-label="Prévia desktop" aria-pressed={!mobile} className={!mobile?"chosen":""} onClick={()=>setMobile(false)}><Monitor size={18}/></button><button aria-label="Prévia celular" aria-pressed={mobile} className={mobile?"chosen":""} onClick={()=>setMobile(true)}><DeviceMobile size={18}/></button></div></div><div className={`preview-frame ${mobile?"phone":""}`}><div className="browser-chrome"><div className="window-dots"><i/><i/><i/></div><span>Prévia · {screenTitle}</span><Globe size={13}/></div>{isConfirmation ? <QuizCompletion config={config} kind={confirmationKind} preview/> : <QuizScreen config={config} step={step} position={position}/>}</div><div className="canvas-footer"><span>{step === OFFER_SCREEN ? "↳" : String(isConfirmation ? sequence.length + 1 : position + 1).padStart(2, "0")} / {String(sequence.length + 1).padStart(2, "0")}</span><p>{step===7?"Exibida para leads que não atendem aos critérios.":"Selecione uma tela para editar o conteúdo."}</p><button className="text-button" onClick={()=>setPreview(true)}>Testar fluxo <ArrowRight size={14}/></button></div></section>
            <section className="properties" aria-label="Propriedades da tela"><div className="panel-title">Editar tela <SlidersHorizontal size={17}/></div><div className="properties-body"><h2>{screenTitle}</h2>
              {config.screenOrder.includes(step) && (
                <div className="screen-actions screen-position" aria-label="Posição da tela selecionada">
                  <button className="button secondary" disabled={position === 0} onClick={() => moveScreen(-1)}><ArrowUp size={15}/> Subir</button>
                  <button className="button secondary" disabled={position >= config.screenOrder.length - 1} onClick={() => moveScreen(1)}><ArrowDown size={15}/> Descer</button>
                </div>
              )}
              {customScreen && (
                <div>
                  <QuizCopyField key={customScreen.id + "-title"} label="Título" value={customScreen.title}
                    onChange={title => updateScreen({ ...customScreen, title })}/>
                  <QuizCopyField key={customScreen.id + "-subtitle"} label="Subtítulo" value={customScreen.subtitle}
                    onChange={subtitle => updateScreen({ ...customScreen, subtitle })}/>
                  {customScreen.kind === "text" && (
                    <label className="screen-required">
                      <input type="checkbox" checked={customScreen.required} onChange={e => updateScreen({ ...customScreen, required: e.target.checked })}/>
                      Resposta obrigatória
                    </label>
                  )}
                  <button className="text-button" onClick={() => removeScreen(customScreen.id)}>Remover tela</button>
                </div>
              )}
              {step===0 && <>{field("welcomeKicker","Frase acima do título")}{field("headline","Título principal",true)}{field("subheadline","Subtítulo",true)}{field("support","Texto de suporte",true)}{field("cta","Texto do botão")}{buttonSize("ctaFontSize")}<label className="field">Logotipo personalizado<span className="upload-control"><UploadSimple size={18}/>Enviar imagem<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void upload(e.target.files?.[0]);e.target.value="";}}/></span><small>PNG, JPG ou WebP · até 800 KB</small></label>{config.logo&&<button className="text-button" onClick={()=>change("logo","")}>Remover logotipo</button>}<label className="field">Cor dos botões<div className="color-field"><input aria-label="Cor dos botões" type="color" value={config.color} onChange={e=>change("color",e.target.value)}/><span>{config.color.toUpperCase()}</span></div></label></>}
              {step === 0 && (
                <label className="field">
                  Cor de fundo do quiz
                  <span className="color-field">
                    <input type="color" value={config.backgroundColor} onChange={e => change("backgroundColor", e.target.value)} />
                    <span>{config.backgroundColor.toUpperCase()}</span>
                  </span>
                  <small>Aplica a todas as telas.</small>
                </label>
              )}
              {questionFields && <>
                {field(questionFields.title, "Título da pergunta", true)}
                {field(questionFields.subtitle, "Subtítulo (opcional)", true)}
              </>}
              {isAnswerScreen(step) && (
                <div>
                  <label className="screen-required">
                    <input
                      type="checkbox"
                      checked={config.requiredAnswers[step]}
                      onChange={e => change("requiredAnswers", { ...config.requiredAnswers, [step]: e.target.checked })}
                    />
                    {step === 6 ? "E-mail obrigatório" : "Resposta obrigatória"}
                  </label>
                  {(step === 4 || step === 5) && !config.requiredAnswers[step] && (
                    <p className="muted">Se a pessoa deixar esta pergunta em branco, o quiz seguirá para a próxima tela.</p>
                  )}
                </div>
              )}
              {(step === 4 || step === 5) && <>
                <button className="button secondary" onClick={() => setTab("Regras")}>Editar regras</button>
                {(step === 4 ? REVENUE_OPTIONS : INVESTMENT_OPTIONS).map(option => (
                  <div className="rule-option" key={option.id}>
                    <strong>{option.label}</strong>
                    <small>{DESTINATION_LABELS[
                      option.id === "yes" || option.id === "no"
                        ? config.rules.investment[option.id]
                        : config.rules.revenue[option.id]
                    ]}</small>
                  </div>
                ))}
              </>}
              {step===6&&<>{field("meetingTitle","Nome da reunião")}<Duration value={config.duration} onChange={v=>change("duration",v)}/><div className="property-note"><Info size={18}/><p>Os horários do link publicado vêm da aba Agendamentos.</p></div><p className="muted">O e-mail será solicitado nesta tela. Nome e WhatsApp serão reaproveitados.</p></>}
              {isConfirmation && (
                <div>
                  <label className="field">Mensagem exibida após
                    <select value={confirmationKind} onChange={event => setConfirmationKind(event.target.value === "contact" ? "contact" : "booking")}>
                      <option value="booking">Agendamento confirmado</option>
                      <option value="contact">Envio do contato</option>
                    </select>
                  </label>
                  {confirmationKind === "booking" ? <>
                    {field("bookingConfirmationTitle", "Título da confirmação", true)}
                    {field("bookingConfirmationMessage", "Mensagem final", true)}
                    <p className="muted">Exibida depois que o horário é reservado.</p>
                  </> : <>
                    {field("contactConfirmationTitle", "Título da confirmação", true)}
                    {field("contactConfirmationMessage", "Mensagem final", true)}
                    <p className="muted">Exibida no quiz publicado após o envio do contato.</p>
                  </>}
                </div>
              )}
              {step===7&&<>{field("offerKicker","Frase acima do título")}{field("offerTitle","Título da oferta",true)}{field("offerText","Descrição",true)}{field("offerCta","Texto do botão")}{buttonSize("offerCtaFontSize")}{field("offerUrl","Link da oferta (HTTPS)")}<p className="muted">Configure o destino do produto ou serviço de menor ticket.</p></>}
            </div></section>
          </div>}
          {tab === "Regras" && (
            <RulesEditor
              rules={config.rules}
              onChange={rules => change("rules", rules)}
              onEditOffer={() => { setStep(7); setTab("Editor"); }}
            />
          )}
          {tab === "Respostas" && <QuizResponses quizId={quizId}/>}
          {tab==="Configurações"&&<div className="settings-page"><h2>Configurações do quiz</h2>{field("name","Nome interno do quiz")}{field("meetingTitle","Nome da reunião")}<Duration value={config.duration} onChange={v=>change("duration",v)}/><div className="property-note"><Info size={18}/><p>Salve o rascunho e atualize a publicação para aplicar as alterações ao quiz público.</p></div><button className="button primary" disabled={saving} onClick={save}>{saving ? "Salvando…" : "Salvar rascunho"}</button></div>}
        </> : view === "Agendamentos" ? <><PageHeading title="Agendamentos" text="Defina os horários disponíveis e acompanhe as reservas confirmadas."/><AgendaPanel googleConnectionError={googleConnectionError}/></> : view==="Configurações" ? <><PageHeading title="Configurações" text="Os detalhes que fazem sua operação funcionar."/><div className="settings-page"><h2>Reuniões por quiz</h2><p className="muted">Edite o nome e a duração da reunião nas configurações de cada quiz.</p><button className="button secondary" onClick={() => { setView("Quizzes"); if (quizId !== null) setTab("Configurações"); }}>Abrir quizzes</button><h2 className="spaced-title">Integrações</h2><button className="button secondary" onClick={() => setView("Agendamentos")}>Configurar agenda e e-mail</button><MetaSettingsPanel/></div></> : view==="Início" ? <><PageHeading title="Sua captação, em um só lugar." text="Estamos montando o caminho entre o primeiro clique e a próxima reunião."/><div className="overview"><span className="badge green">ETAPA 1</span><h2>Suas páginas de captação</h2><p>Edite a apresentação, confira as regras e percorra a experiência do lead antes de conectar suas ferramentas.</p><button className="button primary" onClick={()=>setView("Quizzes")}>Abrir quizzes <ArrowRight size={18}/></button><div className="milestones"><span><CheckCircle/>Editor e prévia</span><span><Clock/>Agenda e integrações</span><span><CheckCircle/>CRM</span></div></div></> : <><PageHeading title="CRM" text="Acompanhe os leads com reunião agendada e avance cada negociação."/><CrmBoard/></>}
      </main><footer className="app-footer"><span>gatu.digital</span><span>Agendador local</span></footer>
    </div>
    {notice&&<div role="status" className="toast"><Info size={18}/>{notice}<button className="icon-button" aria-label="Fechar aviso" onClick={()=>setNotice("")}><X size={16}/></button></div>}
    {preview&&<PreviewModal config={config} onClose={()=>setPreview(false)}/>}
  </div>;
}

type ResponseList = NonNullable<Awaited<ReturnType<typeof loadQuizResponses>>["responses"]>;

function QuizResponses({ quizId }: { quizId: number }) {
  const [responses, setResponses] = useState<ResponseList | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let current = true;
    async function load() {
      setPending(true);
      setError("");
      try {
        const result = await loadQuizResponses(quizId);
        if (!current) return;
        if (result.responses) setResponses(result.responses);
        else setError(result.error || "Não foi possível carregar as respostas.");
      } catch {
        if (current) setError("Não foi possível carregar as respostas.");
      } finally {
        if (current) setPending(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [quizId, refresh]);

  return <section className="rules-page">
    <div className="response-heading">
      <h2>Respostas recebidas</h2>
      <button className="button secondary" disabled={pending} onClick={() => setRefresh(value => value + 1)}>Atualizar lista</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {pending && !responses && <p role="status">Carregando respostas…</p>}
    {responses?.length === 0 && <p className="muted">As respostas enviadas pelo link do quiz aparecerão aqui.</p>}
    {responses?.map(({ id, receivedAt, outcome, bookingStart, answers, extra }) => (
      <details className="response-item" key={id}>
        <summary>
          <strong>{answers.name || answers.email || answers.phone || "Resposta sem nome"}</strong>
          <span>{bookingStart !== null ? "Reunião agendada" : outcome === "alternative" ? "Oferta alternativa" : "Contato recebido"}</span>
          <time dateTime={new Date(receivedAt).toISOString()}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(receivedAt)}</time>
        </summary>
        <dl>
          {[
            { title: "WhatsApp", answer: answers.phone },
            { title: "Instagram", answer: answers.instagram },
            { title: "E-mail", answer: answers.email },
            { title: "Faturamento", answer: REVENUE_OPTIONS.find(option => option.id === answers.revenue)?.label },
            { title: "Investimento", answer: INVESTMENT_OPTIONS.find(option => option.id === answers.investment)?.label },
            ...extra,
          ].map(({ title, answer }, index) => answer && <div key={index}><dt>{title}</dt><dd>{answer}</dd></div>)}
        </dl>
      </details>
    ))}
    {responses?.length === 100 && <p className="muted">Exibindo as 100 respostas mais recentes.</p>}
  </section>;
}

function RulesEditor({ rules, onChange, onEditOffer }: {
  rules: QuizRules;
  onChange: (rules: QuizRules) => void;
  onEditOffer: () => void;
}) {
  return (
    <section className="rules-page">
      <div className="section-intro">
        <h2>Regras de qualificação</h2>
        <p>Escolha quais respostas continuam na ordem do editor e quais abrem a oferta alternativa.</p>
      </div>
      <div className="rule-groups">
        <fieldset className="rule-group">
          <legend>{STEPS[4].title}</legend>
          {REVENUE_OPTIONS.map(({ id, label }) => (
            <label className="field" key={id}>
              {label}
              <select value={rules.revenue[id]} onChange={event => {
                const destination = event.currentTarget.value === "investment" ? "investment" : "alternative";
                onChange({ ...rules, revenue: { ...rules.revenue, [id]: destination } });
              }}>
                <option value="investment">{DESTINATION_LABELS.investment}</option>
                <option value="alternative">{DESTINATION_LABELS.alternative}</option>
              </select>
            </label>
          ))}
        </fieldset>
        <fieldset className="rule-group">
          <legend>{STEPS[5].title}</legend>
          {INVESTMENT_OPTIONS.map(({ id, label }) => (
            <label className="field" key={id}>
              {label}
              <select value={rules.investment[id]} onChange={event => {
                const destination = event.currentTarget.value === "schedule" ? "schedule" : "alternative";
                onChange({ ...rules, investment: { ...rules.investment, [id]: destination } });
              }}>
                <option value="schedule">{DESTINATION_LABELS.schedule}</option>
                <option value="alternative">{DESTINATION_LABELS.alternative}</option>
              </select>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="alternative-rule">
        <GitBranch size={24} />
        <div>
          <h3>Oferta alternativa</h3>
          <p>Esta é a tela exibida quando uma resposta é direcionada à oferta.</p>
        </div>
        <button className="button secondary" onClick={onEditOffer}>Editar oferta</button>
      </div>
    </section>
  );
}

function PageHeading({title,text}:{title:string;text:string}) {return <div className="page-heading"><div><div className="eyebrow">WORKSPACE</div><h1>{title}</h1><p>{text}</p></div></div>;}
function Duration({value,onChange}:{value:number;onChange:(value:number)=>void}) {return <label className="field">Duração da reunião<select value={value} onChange={e=>onChange(Number(e.target.value))}>{[15,30,45,60,90,120,180,240].map(n=><option value={n} key={n}>{n} minutos{n===60?" · padrão":""}</option>)}</select></label>;}

function PreviewModal({config,onClose}:{config:QuizConfig;onClose:()=>void}) {
  const dialogRef=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=dialogRef.current;
    const previous=document.activeElement as HTMLElement|null;
    dialog?.showModal();
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return ()=>{dialog?.close();document.body.style.overflow=oldOverflow;previous?.focus();};
  },[]);
  return (
    <dialog ref={dialogRef} className="preview-modal" onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="preview-title">
      <div className="modal-header">
        <div><span className="badge green">MODO DE TESTE</span><strong id="preview-title">Experiência do lead</strong></div>
        <button className="icon-button" aria-label="Fechar prévia" onClick={onClose}><X size={22}/></button>
      </div>
      <div className="modal-notice"><Info size={16}/>Respostas de teste não são salvas nem enviadas.</div>
      <QuizFlow config={config}/>
    </dialog>
  );
}

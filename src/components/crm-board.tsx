"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { CalendarBlank, MagnifyingGlass, Trash, X } from "@phosphor-icons/react";
import { loadCrm, loadLeadActivity, removeCrmCard, updateCrmLead } from "../app/actions";
import { CRM_NOTE_LIMIT, CRM_STAGES, isCrmStage, parseDealValue, stageLabel, type CrmEdit, type CrmStage } from "../lib/crm";
import { INVESTMENT_OPTIONS, REVENUE_OPTIONS } from "../lib/quiz";
import { AGENDA_ZONE } from "../lib/schedule";

type Lead = NonNullable<Awaited<ReturnType<typeof loadCrm>>["leads"]>[number];
type Activity = NonNullable<Awaited<ReturnType<typeof loadLeadActivity>>["activity"]>;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: AGENDA_ZONE });
const currencyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const valueFormat = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const crmDragType = "application/x-gatu-crm-lead";

function leadName(lead: Lead) {
  return lead.answers.name || lead.answers.email || lead.answers.phone || "Lead sem nome";
}

function filterText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export default function CrmBoard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [moving, setMoving] = useState<CrmStage>();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadCrm().then(result => {
      if (!active) return;
      if (result.leads) setLeads(result.leads);
      else setError(result.error || "Não foi possível carregar o CRM.");
    }).catch(() => { if (active) setError("Não foi possível carregar o CRM."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const filter = filterText(query.trim());
  const visible = leads.filter(lead => !filter || [lead.answers.name, lead.answers.email, lead.answers.phone, lead.answers.instagram,
    lead.source?.utm_source, lead.source?.utm_campaign].some(value => value && filterText(value).includes(filter)));
  const selectedLead = leads.find(lead => lead.id === selectedId);

  async function edit(lead: Lead, change: CrmEdit) {
    if (pending.current || loading) return "Aguarde a atualização do quadro.";
    pending.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateCrmLead(lead.id, lead.revision, change);
      if (!result.lead) return result.error || "Não foi possível salvar o cartão.";
      setLeads(current => current.map(item => item.id === lead.id ? result.lead : item));
      setNotice("stage" in change ? `Cartão movido para ${stageLabel(change.stage)}.` : "Ficha atualizada.");
      return "";
    } catch {
      return "Não foi possível salvar o cartão.";
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  async function remove(lead: Lead) {
    if (pending.current || loading) return "Aguarde a atualização do quadro.";
    pending.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await removeCrmCard(lead.id, lead.revision);
      if (!result.deleted) return result.error || "Não foi possível excluir o cartão.";
      setLeads(current => current.filter(item => item.id !== lead.id));
      setSelectedId(undefined);
      setNotice("Cartão excluído do CRM.");
      return "";
    } catch {
      return "Não foi possível excluir o cartão.";
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  async function drop(event: DragEvent<HTMLElement>, stage: CrmStage) {
    event.preventDefault();
    setMoving(undefined);
    const id = event.dataTransfer.getData(crmDragType);
    const lead = leads.find(item => item.id === id);
    if (!lead || lead.stage === stage) return;
    const message = await edit(lead, { stage });
    if (message) setError(message);
  }

  return <div className="crm-workspace">
    <div className="crm-toolbar">
      <label className="crm-search"><MagnifyingGlass size={17} aria-hidden="true"/>
        <span className="sr-only">Buscar leads</span>
        <input type="search" placeholder="Buscar por nome, contato ou campanha" value={query} onChange={event => setQuery(event.target.value)}/>
      </label>
      <button className="button secondary" disabled={loading || saving} onClick={() => setReload(value => value + 1)}>Atualizar quadro</button>
    </div>
    {loading && <p className="muted" role="status">Carregando CRM…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="muted crm-notice" role="status">{notice}</p>}
    {!loading && !error && !leads.length && <p className="muted">As reservas confirmadas aparecerão em Agendado.</p>}
    {leads.length > 0 && !visible.length && <p className="muted">Nenhum lead encontrado para essa busca.</p>}

    <div className="crm-board" aria-label="Quadro de leads" tabIndex={0}>
      {CRM_STAGES.map(stage => {
        const cards = visible.filter(lead => lead.stage === stage.id);
        return <section key={stage.id} className={`crm-lane${moving === stage.id ? " crm-lane-target" : ""}`} aria-label={stage.label}
          onDragOver={event => {
            if (!event.dataTransfer.types.includes(crmDragType) || saving) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setMoving(stage.id);
          }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMoving(undefined); }}
          onDrop={event => { void drop(event, stage.id); }}>
          <div className="crm-lane-heading"><h2>{stage.label}</h2><span className="badge">{cards.length}</span></div>
          {cards.map(lead => <button key={lead.id} className="crm-card" draggable={!saving}
            onDragStart={event => { event.dataTransfer.setData(crmDragType, lead.id); event.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setMoving(undefined)} onClick={() => setSelectedId(lead.id)}>
            <strong>{leadName(lead)}</strong>
            {lead.answers.name && (lead.answers.email || lead.answers.phone) && <small>{lead.answers.email || lead.answers.phone}</small>}
            <span><CalendarBlank size={14}/><time dateTime={new Date(lead.start).toISOString()}>{dateFormat.format(lead.start)}</time></span>
            {(lead.source?.utm_campaign || lead.source?.utm_source) && <small className="crm-source">{lead.source.utm_campaign || lead.source.utm_source}</small>}
            {lead.dealValueCents !== null && <small className="crm-deal-amount">{currencyFormat.format(lead.dealValueCents / 100)}</small>}
          </button>)}
        </section>;
      })}
    </div>
    {selectedLead && <LeadDetails key={selectedLead.id} lead={selectedLead} busy={saving} onClose={() => setSelectedId(undefined)}
      onEdit={change => edit(selectedLead, change)} onRemove={() => remove(selectedLead)}/>}
  </div>;
}

function LeadDetails({ lead, busy, onClose, onEdit, onRemove }: {
  lead: Lead;
  busy: boolean;
  onClose: () => void;
  onEdit: (change: CrmEdit) => Promise<string>;
  onRemove: () => Promise<string>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState(lead.note);
  const [dealValue, setDealValue] = useState(lead.dealValueCents === null ? "" : valueFormat.format(lead.dealValueCents / 100));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activity, setActivity] = useState<Activity>([]);
  const [activityError, setActivityError] = useState("");
  const [removeError, setRemoveError] = useState("");
  const noteDirty = note.trim() !== lead.note;
  const dealValueCents = parseDealValue(dealValue);
  const valueDirty = dealValueCents !== lead.dealValueCents;

  useEffect(() => {
    const element = dialog.current;
    const target = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); target?.focus(); };
  }, []);

  useEffect(() => {
    let active = true;
    setActivityError("");
    loadLeadActivity(lead.id).then(result => {
      if (!active) return;
      if (result.activity) setActivity(result.activity);
      else setActivityError(result.error || "Não foi possível carregar o histórico.");
    }).catch(() => { if (active) setActivityError("Não foi possível carregar o histórico."); });
    return () => { active = false; };
  }, [lead.id, lead.revision]);

  function close() {
    if (!busy && (!(noteDirty || valueDirty) || window.confirm("Fechar sem salvar as alterações?"))) onClose();
  }

  async function save(change: CrmEdit) {
    setNotice("");
    const message = await onEdit(change);
    setError(message);
    if (message) return;
    if ("dealValueCents" in change) {
      setDealValue(change.dealValueCents === null ? "" : valueFormat.format(change.dealValueCents / 100));
      setNotice("Valor do negócio salvo.");
    } else setNotice("stage" in change ? "Etapa atualizada." : "Anotação salva.");
  }

  function saveDealValue() {
    if (dealValueCents === undefined) {
      setNotice("");
      setError("Informe um valor válido em reais, como 1.500,00.");
      return;
    }
    void save({ dealValueCents });
  }

  async function removeCard() {
    if (!window.confirm(`Excluir o cartão de "${leadName(lead)}" do CRM? As anotações, o valor e o histórico do cartão serão apagados. A reunião sairá da lista de próximas reuniões e o horário continuará reservado.`)) return;
    setRemoveError("");
    const message = await onRemove();
    if (message) setRemoveError(message);
  }

  const fields = [
    { title: "WhatsApp", answer: lead.answers.phone },
    { title: "E-mail", answer: lead.answers.email },
    { title: "Instagram", answer: lead.answers.instagram },
    { title: "Faturamento", answer: REVENUE_OPTIONS.find(option => option.id === lead.answers.revenue)?.label },
    { title: "Investimento", answer: INVESTMENT_OPTIONS.find(option => option.id === lead.answers.investment)?.label },
    ...lead.extra,
  ].filter(item => item.answer);

  return <dialog ref={dialog} className="crm-dialog" aria-labelledby="crm-lead-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="crm-dialog-header">
      <div><h2 id="crm-lead-title">{leadName(lead)}</h2><p>{lead.title || "Reunião"} · {dateFormat.format(lead.start)} · Brasília</p></div>
      <button className="icon-button" aria-label="Fechar ficha do lead" disabled={busy} onClick={close}><X size={20}/></button>
    </header>
    <div className="crm-dialog-body">
      <label className="field">Etapa do lead
        <select value={lead.stage} disabled={busy} onChange={event => {
          const stage = event.target.value;
          if (isCrmStage(stage)) void save({ stage });
        }}>
          {CRM_STAGES.map(stage => <option key={stage.id} value={stage.id}
            disabled={stage.id === "won" && valueDirty && lead.stage !== "won"}>{stage.label}</option>)}
        </select>
      </label>
      <section className="crm-deal-section">
        <form className="crm-deal-form" onSubmit={event => { event.preventDefault(); saveDealValue(); }}>
          <label className="field">Valor do negócio (R$)
            <input type="text" inputMode="decimal" maxLength={22} placeholder="0,00" value={dealValue}
              disabled={busy} onChange={event => setDealValue(event.target.value)}/>
          </label>
          <button className="button primary" disabled={!valueDirty || busy}>Salvar valor</button>
        </form>
        {valueDirty && lead.stage !== "won" && <p className="muted">Salve o valor editado antes de mover o card para Ganho.</p>}
        {lead.stage === "won" && lead.dealValueCents === null && lead.metaTracking?.purchaseConsent &&
          <p className="muted">Salve o valor do negócio para enviar o fechamento ao Meta.</p>}
      </section>
      {!!fields.length && <section><h3>Contato e respostas</h3>
        <dl>{fields.map(({ title, answer }, index) => <div key={`${title}-${index}`}><dt>{title}</dt><dd>{answer}</dd></div>)}</dl>
      </section>}
      <section><h3>Parâmetros UTM</h3>
        <dl className="crm-utm-fields">{(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const).map(key => (
          <div key={key}><dt><code>{key}</code></dt><dd>{lead.source?.[key] || <span className="muted">Não informado</span>}</dd></div>
        ))}</dl>
      </section>
      <section>
        <details>
          <summary className="crm-meta-summary">Rastreamento Meta</summary>
          {lead.metaTracking ? <>
            <p className="muted">Autorizado no quiz em {dateFormat.format(lead.metaTracking.consentAt)}.</p>
            {!lead.metaTracking.purchaseConsent && <p className="muted">A autorização registrada permite medir agendamentos.</p>}
            <dl>{[
              ["fbp (navegador)", lead.metaTracking.fbp], ["fbc (clique)", lead.metaTracking.fbc],
              ["fbclid", lead.metaTracking.fbclid], ["URL do quiz", lead.metaTracking.eventSourceUrl],
              ["Identificação do navegador", lead.metaTracking.clientUserAgent],
            ].map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd><code>{value}</code></dd></div>)}</dl>
            {!lead.metaTracking.fbp && !lead.metaTracking.fbc && <p className="muted">Nenhum identificador de clique ou cookie Meta estava disponível.</p>}
          </> : <p className="muted">Nenhum dado Meta registrado para esta reserva.</p>}
        </details>
      </section>
      <section><h3>Anotações</h3>
        <label className="field"><span className="sr-only">Anotação interna sobre o lead</span>
          <textarea rows={4} maxLength={CRM_NOTE_LIMIT} value={note} disabled={busy} onChange={event => setNote(event.target.value)}/>
        </label>
        <button className="button primary" disabled={!noteDirty || busy} onClick={() => save({ note })}>Salvar anotação</button>
      </section>
      {notice && <p className="muted" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <section><h3>Histórico</h3>
        {activityError && <p role="alert" className="form-error">{activityError}</p>}
        <ol className="crm-history">
          {activity.map(item => <li key={item.id}><time>{dateFormat.format(item.createdAt)}</time>
            <span>{item.kind === "stage" && item.fromStage && item.toStage
              ? `${stageLabel(item.fromStage)} → ${stageLabel(item.toStage)}` : "Anotação atualizada"}</span></li>)}
          <li><time>{dateFormat.format(lead.bookedAt)}</time><span>Reserva confirmada</span></li>
        </ol>
      </section>
      <section>
        <button type="button" className="button secondary crm-delete-button" disabled={busy} onClick={removeCard}>
          <Trash size={16} aria-hidden="true"/> Excluir card
        </button>
        {removeError && <p className="form-error" role="alert">{removeError}</p>}
      </section>
    </div>
  </dialog>;
}

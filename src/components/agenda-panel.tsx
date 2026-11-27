"use client";

import { useEffect, useState } from "react";
import { CalendarBlank, Plus, X } from "@phosphor-icons/react";
import { disconnectGoogle, loadAgenda, retryGoogleBooking, saveAgenda, startGoogleConnection } from "../app/actions";
import { activeAgenda, formatBookingTime, SLOT_INTERVALS, validAgendaDate, WEEKDAYS, type AgendaConfig, type AgendaDay } from "../lib/schedule";

type Bookings = NonNullable<Awaited<ReturnType<typeof loadAgenda>>["bookings"]>;
export default function AgendaPanel({ googleConnectionError }: { googleConnectionError: boolean }) {
  const [config, setConfig] = useState<AgendaConfig | null>(null);
  const [revision, setRevision] = useState(0);
  const [bookings, setBookings] = useState<Bookings>([]);
  const [blockDate, setBlockDate] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [google, setGoogle] = useState<{ configured: boolean; connected: boolean }>();
  const [syncing, setSyncing] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState(googleConnectionError ? "A conexão com o Google Agenda não foi concluída. Confira as permissões e tente novamente." : "");
  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await loadAgenda();
        if (!current) return;
        if (result.agenda && result.bookings && result.google) {
          setConfig(result.agenda.config);
          setRevision(result.agenda.revision);
          setBookings(result.bookings);
          setGoogle(result.google);
          setDirty(false);
        } else setError(result.error || "Não foi possível carregar a agenda.");
      } catch {
        if (current) setError("Não foi possível carregar a agenda.");
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [refresh]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function update(next: AgendaConfig) {
    setConfig(next);
    setDirty(true);
    setStatus("");
    setError("");
  }

  function changeDay(index: number, patch: Partial<AgendaDay>) {
    if (config) update({ ...config, days: config.days.map((day, i) => i === index ? { ...day, ...patch } : day) });
  }

  function addBlock() {
    if (!config || !validAgendaDate(blockDate) || config.blockedDates.includes(blockDate)) return;
    update({ ...config, blockedDates: [...config.blockedDates, blockDate].sort() });
    setBlockDate("");
  }

  async function save() {
    if (!config || saving || loading) return;
    setSaving(true);
    setStatus("");
    setError("");
    try {
      const result = await saveAgenda(config, revision);
      if (result.agenda) {
        setConfig(result.agenda.config);
        setRevision(result.agenda.revision);
        setDirty(false);
        setStatus("Disponibilidade salva. As mudanças já valem para o quiz publicado.");
      } else setError(result.error || "Não foi possível salvar a agenda.");
    } catch {
      setError("Não foi possível salvar a agenda.");
    } finally {
      setSaving(false);
    }
  }

  async function sync(id?: string) {
    if (syncing) return;
    setSyncing(id ?? "disconnect");
    setGoogleError("");
    try {
      if (!id) {
        const result = await disconnectGoogle();
        if (result.disconnected) setGoogle(current => current ? { ...current, connected: false } : current);
        else setGoogleError(result.error || "Não foi possível desconectar o Google Agenda.");
      } else {
        const result = await retryGoogleBooking(id);
        if (result.synced) setBookings(current => current.map(item => item.id === id ? { ...item, googleSynced: true, googleInvited: result.invited } : item));
        else setGoogleError(result.error || "Não foi possível sincronizar a reunião.");
      }
    } catch {
      setGoogleError("Não foi possível concluir a operação no Google Agenda.");
    } finally {
      setSyncing(null);
    }
  }

  return <div className="agenda-workspace">
    <section className="settings-page" aria-label="Configuração de disponibilidade">
      <h2>Disponibilidade semanal</h2>
      <p className="muted">Horário de Brasília. Ative os dias em que deseja receber reuniões.</p>
      {loading && <p role="status">Carregando agenda…</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {!config && !loading && <button className="button secondary" onClick={() => setRefresh(value => value + 1)}>Tentar novamente</button>}
      {config && <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="agenda-fields" disabled={saving || loading}>
          {config.days.map((day, index) => <div className="agenda-day" key={WEEKDAYS[index]}>
            <label className="agenda-day-toggle"><input type="checkbox" checked={day.enabled}
              onChange={event => changeDay(index, { enabled: event.target.checked })}/>{WEEKDAYS[index]}</label>
            <label>Início<input aria-label={`Início, ${WEEKDAYS[index]}`} type="time" required disabled={!day.enabled} value={day.start}
              onChange={event => changeDay(index, { start: event.target.value })}/></label>
            <label>Fim<input aria-label={`Fim, ${WEEKDAYS[index]}`} type="time" required disabled={!day.enabled} value={day.end}
              onChange={event => changeDay(index, { end: event.target.value })}/></label>
          </div>)}
          <div className="agenda-limits">
            <label className="field">Antecedência mínima (horas)<input type="number" min={0} max={168} required value={Number.isNaN(config.noticeHours) ? "" : config.noticeHours}
              onChange={event => update({ ...config, noticeHours: event.target.valueAsNumber })}/></label>
            <label className="field">Período aberto (dias)<input type="number" min={1} max={60} required value={Number.isNaN(config.horizonDays) ? "" : config.horizonDays}
              onChange={event => update({ ...config, horizonDays: event.target.valueAsNumber })}/></label>
            <label className="field">Intervalo entre horários
              <select value={config.slotIntervalMinutes} onChange={event => {
                const value = Number(event.target.value);
                const interval = SLOT_INTERVALS.find(option => option === value);
                if (interval !== undefined) update({ ...config, slotIntervalMinutes: interval });
              }}>
                {SLOT_INTERVALS.map(interval => <option key={interval} value={interval}>{interval} minutos</option>)}
              </select>
              <small>Contado a partir do início da faixa. A duração da reunião é definida no quiz.</small>
            </label>
          </div>
          <h3>Bloqueios por data</h3>
          <div className="agenda-block-row">
            <label className="field">Data para bloquear<input type="date" value={blockDate} onChange={event => setBlockDate(event.target.value)}/></label>
            <button type="button" className="button secondary" disabled={!validAgendaDate(blockDate) || config.blockedDates.includes(blockDate)} onClick={addBlock}><Plus size={16}/>Bloquear dia</button>
          </div>
          {!!config.blockedDates.length && <ul className="agenda-blocks">
            {config.blockedDates.map(date => <li key={date}>
              <time dateTime={date}>{date.split("-").reverse().join("/")}</time>
              <button className="icon-button" type="button" aria-label={`Remover bloqueio de ${date}`}
                onClick={() => update({ ...config, blockedDates: config.blockedDates.filter(item => item !== date) })}><X size={15}/></button>
            </li>)}
          </ul>}
          {!activeAgenda(config) && <p className="muted">Com todos os dias desativados, o quiz coleta apenas o contato.</p>}
        </fieldset>
        <button className="button primary" disabled={!dirty || saving || loading}>{saving ? "Salvando…" : "Salvar disponibilidade"}</button>
        {status && <p className="agenda-status" role="status">{status}</p>}
      </form>}
    </section>

    <section className="settings-page" aria-label="Reservas confirmadas">
      {google && <div className="agenda-google">
        <h2>Google Agenda</h2>
        <p className="muted">{google.connected ? "Calendário principal conectado. O Google envia o convite para o e-mail informado na reserva." : google.configured
          ? "Conecte o calendário principal para bloquear compromissos e criar eventos das reuniões."
          : "A primeira conexão precisa de um cliente OAuth no Google Cloud."}</p>
        {googleError && <p role="alert" className="form-error">{googleError}</p>}
        {google.connected && <button className="button secondary" disabled={!!syncing || dirty}
          onClick={() => { if (window.confirm("Desconectar o Google Agenda? Os eventos já enviados ficam no calendário.")) void sync(); }}>Desconectar</button>}
        {google.configured && <form action={startGoogleConnection}>
          <button className="button primary" disabled={!!syncing || dirty}>{google.connected ? "Reconectar Google Agenda" : "Conectar Google Agenda"}</button>
        </form>}
        {!google.configured && <details className="agenda-google-setup">
          <summary>Conectar Google Agenda</summary>
          <ol>
            <li>Ative a <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer">Google Calendar API</a>.</li>
            <li>Em <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Google Auth Platform → Clientes</a>, use um cliente do tipo <strong>Aplicativo da Web</strong>. Cadastre este endereço como URI de redirecionamento autorizado para os testes locais:
              <code>http://127.0.0.1:3020/api/google-agenda/callback</code>
            </li>
            <li>Salve o ID e o segredo em <code>.env.local</code>, usando as variáveis do <code>.env.example</code>, e reinicie o Agendador.</li>
            <li>Volte a esta aba e clique em <strong>Conectar Google Agenda</strong> para autorizar sua conta.</li>
          </ol>
        </details>}
      </div>}
      <div className="response-heading"><h2><CalendarBlank size={19}/> Próximas reuniões</h2>
        <button className="button secondary" disabled={dirty || loading || saving} onClick={() => setRefresh(value => value + 1)}>Atualizar lista</button>
      </div>
      {!loading && !bookings.length && <p className="muted">Nenhuma reunião confirmada.</p>}
      {bookings.map(booking => <details key={booking.id} className="response-item">
        <summary><strong>{booking.title || "Reunião"}</strong><span>{formatBookingTime(booking.start)}</span></summary>
        <dl>
          {booking.answers.name && <div><dt>Nome</dt><dd>{booking.answers.name}</dd></div>}
          {booking.answers.email && <div><dt>E-mail</dt><dd>{booking.answers.email}</dd></div>}
          {booking.answers.phone && <div><dt>WhatsApp</dt><dd>{booking.answers.phone}</dd></div>}
        </dl>
        <p className="muted">{booking.googleInvited ? "Convidado no Google Agenda"
          : booking.googleSynced ? "Evento no Google Agenda"
          : "Reserva local"}</p>
        {google?.connected && (!booking.googleSynced || (booking.answers.email && !booking.googleInvited)) && (
          <button className="button secondary" disabled={!!syncing} onClick={() => sync(booking.id)}>
            {syncing === booking.id ? "Sincronizando…" : booking.googleSynced ? "Enviar convite pelo Google" : "Sincronizar no Google Agenda"}
          </button>
        )}
      </details>)}
    </section>
  </div>;
}

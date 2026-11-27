"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCircle } from "@phosphor-icons/react";
import { disableBrowserPush, enableBrowserPush, loadBookingNotifications, loadPushSettings, readBookingAlerts } from "../app/actions";
import { AGENDA_ZONE } from "../lib/schedule";

type Feed = NonNullable<Awaited<ReturnType<typeof loadBookingNotifications>>["feed"]>;
const formatTime = new Intl.DateTimeFormat("pt-BR", { timeZone: AGENDA_ZONE, dateStyle: "short", timeStyle: "short" });

export default function BookingNotifications({ onOpenAgenda }: { onOpenAgenda: () => void }) {
  const [feed, setFeed] = useState<Feed>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pushStatus, setPushStatus] = useState<"loading" | "unsupported" | "blocked" | "off" | "on" | "unavailable">("loading");
  const [pushError, setPushError] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const setup = useRef<{ registration: ServiceWorkerRegistration; publicKey: string } | null>(null);

  async function refresh(reportError = false) {
    const current = ++request.current;
    try {
      const result = await loadBookingNotifications();
      if (current !== request.current) return;
      if (result.feed) {
        setFeed(result.feed);
        setError("");
      } else if (reportError) setError(result.error || "Não foi possível carregar as notificações.");
    } catch {
      if (reportError && current === request.current) setError("Não foi possível carregar as notificações.");
    }
  }

  useEffect(() => {
    void refresh();
    function updateOnFocus() { if (document.visibilityState === "visible") void refresh(); }
    const timer = window.setInterval(updateOnFocus, 15_000);
    document.addEventListener("visibilitychange", updateOnFocus);
    window.addEventListener("focus", updateOnFocus);
    return () => {
      request.current++;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateOnFocus);
      window.removeEventListener("focus", updateOnFocus);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    async function prepare() {
      setPushError("");
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setPushStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") { setPushStatus("blocked"); return; }
      setPushStatus("loading");
      try {
        await navigator.serviceWorker.register("/agendador-sw.js");
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        const result = await loadPushSettings(subscription?.endpoint);
        if (!current) return;
        if (!result.publicKey) throw Error("Push settings unavailable");
        setup.current = { registration, publicKey: result.publicKey };
        setPushStatus(result.enabled && Notification.permission === "granted" ? "on" : "off");
      } catch {
        if (current) setPushStatus("unavailable");
      }
    }
    void prepare();
    return () => { current = false; };
  }, [open]);

  async function togglePush() {
    if (!setup.current || busy) return;
    const { registration, publicKey } = setup.current;
    setBusy(true);
    setPushError("");
    try {
      if (pushStatus === "on") {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const result = await disableBrowserPush(subscription.endpoint);
          if (result.error) { setPushError(result.error); return; }
          await subscription.unsubscribe();
        }
        setPushStatus("off");
        return;
      }
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permission !== "granted") {
        if (permission === "denied") setPushStatus("blocked");
        return;
      }
      const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(publicKey.length / 4) * 4, "=");
      const applicationServerKey = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      let subscription = await registration.pushManager.getSubscription();
      const existingKey = subscription?.options.applicationServerKey;
      if (subscription && existingKey && !new Uint8Array(existingKey).every((byte, index) => byte === applicationServerKey[index])) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      const result = await enableBrowserPush(subscription.toJSON());
      if (!result.enabled) { setPushError(result.error || "Não foi possível ativar neste navegador."); return; }
      setPushStatus("on");
    } catch {
      setPushError("Não foi possível alterar as notificações neste navegador.");
    } finally { setBusy(false); }
  }

  async function markRead(id?: string) {
    const current = ++request.current;
    try {
      const result = await readBookingAlerts(id);
      if (result.feed) {
        if (current === request.current) setFeed(result.feed);
        else void refresh();
      } else setError(result.error || "Não foi possível marcar como lida.");
    } catch { setError("Não foi possível marcar como lida."); }
  }

  function toggle() {
    if (!open) void refresh(true);
    setOpen(!open);
  }

  return <div className="booking-alerts" ref={root}>
    <button type="button" ref={trigger} className="icon-button booking-alerts-trigger" aria-expanded={open} aria-controls="booking-alerts-panel"
      aria-label={feed.unread ? `Notificações, ${feed.unread} não lidas` : "Notificações"} onClick={toggle}>
      <Bell size={21} weight={feed.unread ? "fill" : "regular"}/>
      {feed.unread > 0 && <span className="booking-alert-count" aria-hidden="true">{feed.unread > 99 ? "99+" : feed.unread}</span>}
    </button>
    {open && <section id="booking-alerts-panel" className="booking-alert-panel" aria-label="Notificações de agendamento">
      <header className="booking-alert-header">
        <h2>Notificações</h2>
        {feed.unread > 0 && <button className="text-button" type="button" onClick={() => markRead()}><Check size={15}/>Marcar todas como lidas</button>}
      </header>
      <div className="booking-alert-list">
        {error && <p className="form-error" role="alert">{error}</p>}
        {!feed.items.length && <p className="muted booking-alert-empty">Nenhum agendamento novo.</p>}
        {feed.items.map(item => <button key={item.id} type="button" data-unread={item.readAt === null} className="booking-alert-row"
          onClick={() => { void markRead(item.id); setOpen(false); onOpenAgenda(); }}>
          <strong>{item.name}</strong>
          <span>{item.title || "Reunião"} · {formatTime.format(item.start)}</span>
        </button>)}
      </div>
      <div className="booking-alert-settings">
        {pushStatus === "on" && <p><CheckCircle size={16}/> Notificações ativadas neste navegador.</p>}
        {pushStatus === "off" && <p>Receba avisos de novos agendamentos mesmo com a aba fechada.</p>}
        {pushStatus === "blocked" && <p>Permita notificações nas configurações deste site no navegador.</p>}
        {pushStatus === "unsupported" && <p>Notificações push indisponíveis neste navegador ou endereço.</p>}
        {pushStatus === "unavailable" && <p>Não foi possível preparar as notificações do navegador.</p>}
        {pushStatus === "loading" && <p>Verificando notificações do navegador…</p>}
        {pushError && <p role="alert">{pushError}</p>}
        {(pushStatus === "on" || pushStatus === "off") && <button type="button" className={pushStatus === "on" ? "button secondary" : "button primary"}
          disabled={busy} onClick={togglePush}>{busy ? "Aguarde…" : pushStatus === "on" ? "Desativar neste navegador" : "Ativar notificações no navegador"}</button>}
      </div>
    </section>}
  </div>;
}

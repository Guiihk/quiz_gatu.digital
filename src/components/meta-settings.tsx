"use client";

import { useEffect, useState, type FormEvent } from "react";
import { loadMetaIntegration, saveMetaIntegration, testMetaIntegration } from "../app/actions";

type MetaSettings = NonNullable<Awaited<ReturnType<typeof loadMetaIntegration>>["settings"]>;

export default function MetaSettingsPanel() {
  const [settings, setSettings] = useState<MetaSettings>();
  const [pixelId, setPixelId] = useState("");
  const [testCode, setTestCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hasNewToken, setHasNewToken] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = saving || testing;

  useEffect(() => {
    let active = true;
    loadMetaIntegration().then(result => {
      if (!active) return;
      if (!result.settings) {
        setError(result.error || "Não foi possível carregar a integração Meta.");
        return;
      }
      setSettings(result.settings);
      setPixelId(result.settings.pixelId);
      setTestCode(result.settings.testCode);
    }).catch(() => { if (active) setError("Não foi possível carregar a integração Meta."); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await saveMetaIntegration(settings.revision, data);
      if (!result.settings) {
        setError(result.error || "Não foi possível salvar a integração Meta.");
        return;
      }
      form.reset();
      setHasNewToken(false);
      setSettings(result.settings);
      setPixelId(result.settings.pixelId);
      setTestCode(result.settings.testCode);
      setNotice("Configuração do Meta salva.");
    } catch {
      setError("Não foi possível salvar a integração Meta.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!settings || busy || !canTest) return;
    setTesting(true);
    setError("");
    setNotice("");
    try {
      const result = await testMetaIntegration(settings.revision);
      if (!result.eventId) {
        setError(result.error || "Não foi possível testar a integração Meta.");
        return;
      }
      setNotice(`API do Meta aceitou ${result.eventName} para o pixel ${result.pixelId}. Procure o evento em Testar eventos. ID ${result.eventId}.`);
    } catch {
      setError("Não foi possível testar a integração Meta.");
    } finally {
      setTesting(false);
    }
  }

  const changingPixel = Boolean(settings && pixelId.trim() !== settings.pixelId);
  const dirty = changingPixel || hasNewToken || testCode.trim() !== settings?.testCode;
  const canTest = Boolean(settings?.ready && settings.testCode && !dirty);
  const status = settings?.ready ? (settings.testCode ? "Modo teste" : "Configurado") : "Não configurado";

  return <section className="meta-settings" aria-labelledby="meta-settings-title">
    <div className="integration">
      <div><h3 id="meta-settings-title">Meta · API de Conversões</h3><p>Envia reservas, propostas e negócios ganhos ao Meta, com autorização.</p></div>
      {settings && <span className="badge">{status}</span>}
    </div>
    {!settings && !error && <p className="muted" role="status">Carregando integração Meta…</p>}
    {settings && <form onSubmit={save}>
      <label className="field">ID do pixel
        <input name="pixelId" inputMode="numeric" autoComplete="off" maxLength={25} required
          value={pixelId} disabled={busy} onChange={event => setPixelId(event.target.value)}/>
      </label>
      <label className="field">Token de acesso
        <input type="password" name="token" autoComplete="new-password" maxLength={4096} disabled={busy}
          required={!settings.hasToken || changingPixel} aria-describedby="meta-token-help"
          onChange={event => setHasNewToken(Boolean(event.target.value.trim()))}
          placeholder={settings.hasToken && !changingPixel ? "••••••••••••" : undefined}/>
      </label>
      <p className="muted meta-settings-help" id="meta-token-help">{changingPixel
        ? "Informe o token da fonte de dados do novo pixel."
        : settings.hasToken ? "Deixe em branco para manter o token atual." : "Use o token da API de Conversões do Gerenciador de Eventos."}</p>
      <label className="field">Código de teste
        <input name="testCode" autoComplete="off" maxLength={128} aria-describedby="meta-test-help"
          value={testCode} disabled={busy} onChange={event => setTestCode(event.target.value)}/>
      </label>
      <p className="muted meta-settings-help" id="meta-test-help">{settings.requiresTestCode
        ? "O ambiente local só envia eventos quando o código de teste está preenchido."
        : "Preencha para validar em Testar eventos no Gerenciador de Eventos."}</p>
      <div className="meta-settings-actions">
        <button type="submit" className="button primary" disabled={busy}>{saving ? "Salvando…" : "Salvar configuração Meta"}</button>
        <button type="button" className="button secondary" aria-describedby="meta-connection-test-help"
          disabled={busy || !canTest} onClick={sendTest}>{testing ? "Testando…" : "Enviar evento de teste"}</button>
      </div>
      <p className="muted meta-settings-help" id="meta-connection-test-help">{!canTest
        ? "Salve uma configuração com código de teste para liberar o envio."
        : "Envia um diagnóstico com dados fictícios para Testar eventos, sem criar uma reunião."}</p>
    </form>}
    {notice && <p className="muted" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

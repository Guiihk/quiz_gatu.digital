export const CRM_STAGES = [
  { id: "scheduled", label: "Agendado" },
  { id: "confirmed", label: "Confirmado" },
  { id: "met", label: "Reunião realizada" },
  { id: "proposal", label: "Proposta enviada" },
  { id: "won", label: "Ganho" },
  { id: "lost", label: "Perdido" },
] as const;

export type CrmStage = typeof CRM_STAGES[number]["id"];
export type CrmEdit = { stage: CrmStage } | { note: string } | { dealValueCents: number | null };
export const CRM_NOTE_LIMIT = 3000;
export const CRM_VALUE_MAX_CENTS = 99_999_999_999;

export function isCrmStage(value: unknown): value is CrmStage {
  return CRM_STAGES.some(stage => stage.id === value);
}

export function stageLabel(value: CrmStage) {
  return CRM_STAGES.find(stage => stage.id === value)?.label ?? "Agendado";
}

export function parseDealValue(value: string): number | null | undefined {
  const text = value.trim().replace(/^R\$\s*/, "");
  if (!text) return null;

  const localized = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(text);
  const decimalPoint = localized ? null : /^(\d+)\.(\d{1,2})$/.exec(text);
  const match = localized ?? decimalPoint;
  if (!match) return undefined;
  const cents = Number(match[1].replaceAll(".", "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return isDealValueCents(cents) ? cents : undefined;
}

export function isDealValueCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= CRM_VALUE_MAX_CENTS;
}

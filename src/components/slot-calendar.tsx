"use client";

import { useId, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { SlotDay } from "../lib/schedule";

const WEEK_HEADERS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const monthFormat = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "UTC" });
const shortDayFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" });

function monthAt(date: string) {
  return date.slice(0, 7);
}

function adjacentMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function SlotCalendar({ days, value, onChange, disabled = false }: {
  days: SlotDay[];
  value: number | null;
  onChange: (start: number | null) => void;
  disabled?: boolean;
}) {
  const timeHeading = useId();
  const [visibleMonth, setVisibleMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  if (!days.length) return <p className="question-support" role="status">Nenhum horário disponível no período. Tente novamente mais tarde.</p>;

  const firstMonth = monthAt(days[0].date);
  const lastMonth = monthAt(days[days.length - 1].date);
  const month = visibleMonth >= firstMonth && visibleMonth <= lastMonth ? visibleMonth : firstMonth;
  const monthDays = days.filter(day => monthAt(day.date) === month);
  const selected = monthDays.find(day => day.date === selectedDate) ?? monthDays[0];
  const enabled = new Set(monthDays.map(day => day.date));
  const first = new Date(`${month}-01T00:00:00Z`);
  const cells = Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(
    first.getUTCFullYear(), first.getUTCMonth(), index - first.getUTCDay() + 1,
  )));

  function changeMonth(offset: -1 | 1) {
    setVisibleMonth(adjacentMonth(month, offset));
    setSelectedDate("");
    onChange(null);
  }

  return <div className="slot-picker">
    <div className="slot-picker-layout">
      <section className="slot-date-panel" aria-label="Calendário da reunião">
        <h3>Selecione uma data</h3>
        <div className="slot-calendar">
          <div className="slot-calendar-nav">
            <button type="button" aria-label="Mês anterior" disabled={disabled || month <= firstMonth} onClick={() => changeMonth(-1)}><CaretLeft size={16}/></button>
            <strong aria-live="polite">{monthFormat.format(first)}</strong>
            <button type="button" aria-label="Próximo mês" disabled={disabled || month >= lastMonth} onClick={() => changeMonth(1)}><CaretRight size={16}/></button>
          </div>
          <div className="slot-calendar-grid">
            {WEEK_HEADERS.map(label => <span className="slot-weekday" key={label} aria-hidden="true">{label}</span>)}
            {cells.map(cell => {
              const date = cell.toISOString().slice(0, 10);
              if (monthAt(date) !== month) return <span className="slot-outside-day" key={date} aria-hidden="true">{cell.getUTCDate()}</span>;
              const available = enabled.has(date);
              return <button className="slot-day" type="button" key={date} aria-label={dayFormat.format(cell)}
                aria-pressed={selected?.date === date} disabled={!available || disabled}
                onClick={() => { if (selected?.date !== date) onChange(null); setSelectedDate(date); }}>
                {cell.getUTCDate()}
              </button>;
            })}
          </div>
        </div>
      </section>
      <section className="slot-time-panel" aria-labelledby={timeHeading}>
        <h3 id={timeHeading}>Horários disponíveis</h3>
        {selected && <p className="slot-selected-date" aria-live="polite">{shortDayFormat.format(new Date(`${selected.date}T00:00:00Z`))}</p>}
        {selected ? <fieldset className="slot-choices" disabled={disabled}>
          <legend className="sr-only">Horário da reunião</legend>
          {selected.times.map(slot => <label className="slot-option" key={slot.start}>
            <input className="sr-only" type="radio" name={timeHeading} value={slot.start} checked={value === slot.start} onChange={() => onChange(slot.start)}/>
            <span>{slot.label}</span>
          </label>)}
        </fieldset> : <p className="question-support">Nenhum dia com horário disponível neste mês.</p>}
        <p className="slot-timezone">Horário de Brasília</p>
      </section>
    </div>
  </div>;
}

const EXAMPLE_DAYS: SlotDay[] = [
  { date: "2026-11-27", label: "27 de novembro", times: [{ start: 1, label: "14:00" }, { start: 2, label: "15:00" }, { start: 3, label: "16:00" }] },
  { date: "2026-11-30", label: "30 de novembro", times: [{ start: 4, label: "09:00" }, { start: 5, label: "10:00" }] },
  { date: "2026-12-02", label: "2 de dezembro", times: [{ start: 6, label: "13:00" }, { start: 7, label: "14:00" }] },
];

export function ExampleSlotCalendar() {
  const [selected, setSelected] = useState<number | null>(null);
  return <>
    <p className="question-support">Datas de exemplo. A disponibilidade real aparece no quiz publicado.</p>
    <SlotCalendar days={EXAMPLE_DAYS} value={selected} onChange={setSelected}/>
  </>;
}

"use client";

import { useId, useRef, useState } from "react";

export function QuizCopy({ value }: { value: string }) {
  const colors: string[] = [];
  let bold = 0;
  let italic = 0;
  return <span className="quiz-copy">{value.split(/(\[\/?(?:b|i)\]|\[color=#[0-9a-fA-F]{6}\]|\[\/color\])/g).map((part, index) => {
    switch (part) {
      case "[b]": bold++; return null;
      case "[/b]": bold = Math.max(0, bold - 1); return null;
      case "[i]": italic++; return null;
      case "[/i]": italic = Math.max(0, italic - 1); return null;
      case "[/color]": colors.pop(); return null;
    }
    if (part.startsWith("[color=") && /^\[color=#[0-9a-f]{6}\]$/i.test(part)) {
      colors.push(part.slice(7, -1));
      return null;
    }
    if (!part) return null;
    const content = bold ? <strong>{italic ? <em>{part}</em> : part}</strong> : italic ? <em>{part}</em> : part;
    return <span key={index} style={{ color: colors.at(-1) }}>{content}</span>;
  })}</span>;
}

export function QuizCopyField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [color, setColor] = useState("#28734f");

  function format(open: string, close: string) {
    const area = input.current;
    if (!area) return;
    const { selectionStart: start, selectionEnd: end } = area;
    const selected = value.slice(start, end);
    const wrapped = start >= open.length && value.slice(start - open.length, start) === open &&
      value.slice(end, end + close.length) === close;
    const nextStart = wrapped ? start - open.length : start + open.length;
    onChange(wrapped
      ? value.slice(0, start - open.length) + selected + value.slice(end + close.length)
      : value.slice(0, start) + open + selected + close + value.slice(end));
    area.focus();
    requestAnimationFrame(() => area.setSelectionRange(nextStart, nextStart + selected.length));
  }

  return <div className="field quiz-copy-field">
    <label htmlFor={id}>{label}</label>
    <div className="quiz-copy-tools" role="group" aria-label={`Formatação de ${label}`}>
      <button type="button" aria-label="Negrito" onMouseDown={e => e.preventDefault()} onClick={() => format("[b]", "[/b]")}><strong>N</strong></button>
      <button type="button" aria-label="Itálico" onMouseDown={e => e.preventDefault()} onClick={() => format("[i]", "[/i]")}><em>I</em></button>
      <input type="color" aria-label={`Cor de ${label}`} value={color} onChange={e => setColor(e.target.value)}/>
      <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => format(`[color=${color}]`, "[/color]")}>Aplicar cor</button>
    </div>
    <textarea id={id} ref={input} rows={3} value={value} onChange={e => onChange(e.target.value)}/>
    <small>Selecione o trecho para formatar. Pressione Enter para quebrar a linha.</small>
  </div>;
}

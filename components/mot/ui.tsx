"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MIcon } from "./icons";

/* ── animated count-up number ── */
export function CountUp({ value, dur = 700 }: { value: number; dur?: number }) {
  const [disp, setDisp] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const t0 = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setDisp(Math.round(from + (value - from) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return <>{disp}</>;
}

/* ── toggle ── */
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={"toggle" + (on ? " on" : "")} aria-pressed={!!on} onClick={() => onChange(!on)}>
      <i></i>
    </button>
  );
}

/* ── stepper with bump animation ── */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 200,
  step = 5,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [k, setK] = useState(0);
  const set = (v: number) => {
    if (disabled) return;
    onChange(Math.max(min, Math.min(max, v)));
    setK((x) => x + 1);
  };
  return (
    <div className={"stepper" + (disabled ? " disabled" : "")}>
      <button type="button" aria-label="decrease" disabled={disabled} onClick={() => set(value - step)}>
        <MIcon.minus size={18} s={2.2} />
      </button>
      <span className="num">
        <span key={k} className="num-bump">
          {value}
        </span>
      </span>
      <button type="button" aria-label="increase" disabled={disabled} onClick={() => set(value + step)}>
        <MIcon.plus size={18} s={2.2} />
      </button>
    </div>
  );
}

/* ── segmented control with sliding thumb ── */
export function Segmented({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const idx = options.indexOf(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const btn = el.querySelectorAll("button")[idx];
    if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [idx, options.length]);
  useEffect(() => {
    const onR = () => {
      const el = ref.current;
      if (!el) return;
      const btn = el.querySelectorAll("button")[options.indexOf(value)];
      if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  });
  return (
    <div className={"seg" + (disabled ? " disabled" : "")} ref={ref}>
      {thumb && <span className="seg-thumb" style={{ left: thumb.left, width: thumb.width }}></span>}
      {options.map((o) => (
        <button key={o} type="button" className={o === value ? "on" : ""} disabled={disabled} onClick={() => !disabled && onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/* ── empty state ── */
export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-orb">{icon}</div>
      <h2>{title}</h2>
      <p className="t-body">{children}</p>
    </div>
  );
}

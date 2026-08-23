"use client";

import type { ReactNode } from "react";

/**
 * The shared furniture of the Config tab.
 *
 * Lifted out of BoxlyConfigPanel so a practice whose settings we hold ourselves
 * gets the same panel rather than one that merely resembles it. Appearance is
 * unchanged from the Boxly original on purpose: Regent and NuYu are looking at
 * these controls today.
 */

export type Banner = { ok: boolean; msg: string } | null;

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-[1.5rem] border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-ink/55">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Toggle({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${on ? "bg-pine" : "bg-ink/15"}`}
      aria-pressed={on}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}

export function LabeledNumber({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink/55">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          onChange(step < 1 ? parseFloat(e.target.value) || 0 : parseInt(e.target.value, 10) || 0)
        }
        className="w-full rounded-xl border border-line bg-white px-2 py-2 text-sm tabular-nums outline-none focus:border-pine/40"
      />
    </label>
  );
}

export function BannerLine({ banner }: { banner: Banner }) {
  if (!banner) return null;
  return (
    <p className={`text-xs font-semibold ${banner.ok ? "text-pine" : "text-red-600"}`}>
      {banner.msg}
    </p>
  );
}

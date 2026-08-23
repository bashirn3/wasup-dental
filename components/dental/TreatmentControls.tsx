"use client";

import type { TreatmentControl } from "@/lib/agent-editable";
import { treatmentControlId } from "@/lib/agent-editable";
import { BannerLine, LabeledNumber, Section, type Banner } from "@/components/dental/config-ui";

export type Practitioner = { id: string; name: string };

/**
 * Per-treatment settings the booking agent uses: page, clinicians, appointment
 * length, and deposit.
 *
 * Presentation only. Where the values are stored differs by practice — Regent
 * and NuYu keep theirs in their own backend, Dental Aesthetica keeps its in our
 * agent config — but a practice should not be able to tell which by looking, so
 * both go through here.
 */
export default function TreatmentControls({
  treatments,
  practitioners,
  lengthOptions,
  fixedIds,
  banner,
  saving,
  perClinicianLengths = false,
  onChange,
  onSave,
}: {
  treatments: TreatmentControl[];
  practitioners: Practitioner[];
  lengthOptions: number[];
  /** Treatments the practice may edit but not delete. */
  fixedIds: Set<string>;
  banner: Banner;
  saving: boolean;
  /**
   * Whether a clinician may run a treatment to their own length.
   *
   * Off unless the practice's settings have somewhere to keep it. Where it is
   * off the treatment's own length applies to everyone, which is how this panel
   * has always behaved.
   */
  perClinicianLengths?: boolean;
  onChange: (treatments: TreatmentControl[]) => void;
  onSave: () => void;
}) {
  function update(id: string, patch: Partial<TreatmentControl>) {
    onChange(treatments.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function add() {
    const taken = new Set(treatments.map((t) => t.id));
    const base = treatmentControlId("New Treatment");
    let id = base;
    let suffix = 2;
    while (taken.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    onChange([
      ...treatments,
      {
        id,
        name: "New Treatment",
        treatmentPageUrl: "",
        practitionerIds: [],
        appointmentLengthMinutes: 30,
        depositRequired: true,
        depositAmount: 30,
      },
    ]);
  }

  function remove(id: string) {
    if (fixedIds.has(id)) return;
    onChange(treatments.filter((t) => t.id !== id));
  }

  function togglePractitioner(treatment: TreatmentControl, practitionerId: string) {
    const ids = new Set(treatment.practitionerIds ?? []);
    if (ids.has(practitionerId)) ids.delete(practitionerId);
    else ids.add(practitionerId);
    // A length for a clinician who no longer offers this goes with them, so an
    // orphan figure cannot come back if they are ticked again months later.
    update(treatment.id, {
      practitionerIds: [...ids],
      practitionerLengthMinutes: withoutClinician(treatment, ids),
    });
  }

  function setClinicianLength(treatment: TreatmentControl, practitionerId: string, minutes: number) {
    const next = { ...(treatment.practitionerLengthMinutes ?? {}) };
    // Matching the treatment's own length is stored as no override, so a later
    // change to the treatment carries this clinician with it.
    if (minutes === treatment.appointmentLengthMinutes) delete next[practitionerId];
    else next[practitionerId] = minutes;
    update(treatment.id, { practitionerLengthMinutes: Object.keys(next).length ? next : undefined });
  }

  return (
    <Section
      title="Treatment controls"
      subtitle="Per-treatment settings the booking agent uses: page, clinicians, appointment length, and deposit."
      action={
        <button
          onClick={add}
          className="rounded-full border border-line bg-white px-3 py-2 text-xs font-semibold text-pine hover:border-pine"
        >
          + Add treatment
        </button>
      }
    >
      {treatments.length === 0 ? (
        <p className="text-sm italic text-ink/45">
          No treatments configured for this practice yet.
        </p>
      ) : (
        <div className="space-y-3">
          {treatments.map((t) => (
            <div key={t.id} className="space-y-3 rounded-2xl border border-line bg-mist/30 p-4">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={t.name}
                  onChange={(e) => update(t.id, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-pine/40"
                />
                {!fixedIds.has(t.id) && (
                  <button
                    onClick={() => remove(t.id)}
                    className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-ink/50 hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-ink/55">
                  Treatment page URL
                </label>
                <input
                  type="url"
                  value={t.treatmentPageUrl}
                  onChange={(e) => update(t.id, { treatmentPageUrl: e.target.value })}
                  placeholder="https://practice.co.uk/treatments/…"
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-pine/40"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="space-y-1">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink/55">
                    Appointment length
                  </span>
                  <select
                    value={t.appointmentLengthMinutes}
                    onChange={(e) =>
                      update(t.id, { appointmentLengthMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-line bg-white px-2 py-2 text-sm outline-none focus:border-pine/40"
                  >
                    {lengthChoices(lengthOptions, t.appointmentLengthMinutes).map((m) => (
                      <option key={m} value={m}>
                        {m} minutes
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-1">
                  <input
                    type="checkbox"
                    checked={t.depositRequired}
                    onChange={(e) => update(t.id, { depositRequired: e.target.checked })}
                    className="h-4 w-4 accent-pine"
                  />
                  <span className="text-sm font-semibold text-ink">Deposit required</span>
                </label>
                <LabeledNumber
                  label="Deposit amount"
                  value={t.depositAmount}
                  min={0}
                  max={100000}
                  step={1}
                  onChange={(v) => update(t.id, { depositAmount: v })}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/55">
                    Clinicians
                  </span>
                  <span className="text-xs font-semibold text-pine">
                    {(t.practitionerIds ?? []).length} selected
                  </span>
                </div>
                {practitioners.length === 0 ? (
                  <p className="rounded-xl bg-mist/60 px-3 py-2 text-xs text-ink/55">
                    Dentally practitioners aren&apos;t available from this deployment yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {practitioners.map((p) => {
                      const on = (t.practitionerIds ?? []).includes(p.id);
                      const minutes = clinicianLength(t, p.id);
                      return (
                        <div key={p.id} className="flex items-center gap-1.5">
                          <button
                            onClick={() => togglePractitioner(t, p.id)}
                            className={`min-w-0 flex-1 rounded-xl border px-2.5 py-2 text-left text-xs font-semibold transition ${on ? "border-pine bg-pine/10 text-pine" : "border-line bg-white text-ink hover:border-pine/40"}`}
                          >
                            {on ? "✓ " : "+ "}
                            {p.name}
                          </button>
                          {on && perClinicianLengths && (
                            <select
                              value={minutes}
                              onChange={(e) => setClinicianLength(t, p.id, Number(e.target.value))}
                              aria-label={`Consultation length for ${p.name}`}
                              className="shrink-0 rounded-xl border border-line bg-white px-1.5 py-2 text-xs tabular-nums outline-none focus:border-pine/40"
                            >
                              {lengthChoices(lengthOptions, minutes).map((m) => (
                                <option key={m} value={m}>
                                  {m}m
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <BannerLine banner={banner} />
      <div className="border-t border-line pt-3">
        <button
          disabled={saving}
          onClick={onSave}
          className="rounded-full bg-pine px-4 py-2 text-xs font-semibold text-lime disabled:opacity-50"
        >
          Save treatment config
        </button>
      </div>
    </Section>
  );
}

/**
 * A stored length that is not one of the offered options still has to appear,
 * otherwise opening the panel would silently move the treatment to whichever
 * option the browser picked first.
 */
/** A clinician's own length, or the treatment's where they have none. */
function clinicianLength(treatment: TreatmentControl, practitionerId: string): number {
  return treatment.practitionerLengthMinutes?.[practitionerId] ?? treatment.appointmentLengthMinutes;
}

function withoutClinician(
  treatment: TreatmentControl,
  keep: Set<string>,
): Record<string, number> | undefined {
  const current = treatment.practitionerLengthMinutes;
  if (!current) return undefined;
  const next = Object.fromEntries(Object.entries(current).filter(([id]) => keep.has(id)));
  return Object.keys(next).length ? next : undefined;
}

function lengthChoices(options: number[], current: number): number[] {
  const all = new Set(options);
  if (current > 0) all.add(current);
  return [...all].sort((a, b) => a - b);
}

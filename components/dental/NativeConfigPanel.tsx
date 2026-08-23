"use client";

import { useCallback, useEffect, useState } from "react";
import TreatmentControls, { type Practitioner } from "@/components/dental/TreatmentControls";
import type { Banner } from "@/components/dental/config-ui";
import type { TreatmentControl } from "@/lib/agent-editable";

const LENGTH_OPTIONS = [15, 20, 30, 45, 60];

/**
 * The Config tab for a practice whose settings we hold ourselves.
 *
 * Regent and NuYu proxy every control on that tab to their own backend. A
 * practice that was never on that system has no such backend, so its treatment
 * settings live in its agent config here, read by the booking agent through
 * /api/runtime-config in the same way its opening messages already are.
 */
export default function NativeConfigPanel({
  practiceId,
  practiceName,
}: {
  practiceId: string | null;
  practiceName: string;
}) {
  const [treatments, setTreatments] = useState<TreatmentControl[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setReady(false);
    setLoadError(null);
    try {
      const query = `practiceId=${encodeURIComponent(practiceId)}`;
      const [configRes, practitionerRes] = await Promise.all([
        fetch(`/api/agent-config?${query}`, { cache: "no-store" }),
        // Clinicians are a nicety: without them the panel still shows every
        // other setting, so a Dentally outage must not empty the page.
        fetch(`/api/dentally/practitioners?${query}`, { cache: "no-store" }).catch(() => null),
      ]);

      if (!configRes.ok) throw new Error(`HTTP ${configRes.status}`);
      const config = (await configRes.json()) as {
        config?: { clientEditable?: { treatments?: TreatmentControl[] } } | null;
      };
      setTreatments(config.config?.clientEditable?.treatments ?? []);

      if (practitionerRes?.ok) {
        const payload = (await practitionerRes.json()) as { practitioners?: Practitioner[] };
        setPractitioners(payload.practitioners ?? []);
      } else {
        setPractitioners([]);
      }
      setReady(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load config");
      setReady(true);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch("/api/agent-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ practiceId, treatments }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        config?: { clientEditable?: { treatments?: TreatmentControl[] } };
      };
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      // Shown as saved rather than as typed: the server drops blank rows and
      // fills in ids, and the panel should agree with what was stored.
      setTreatments(payload.config?.clientEditable?.treatments ?? treatments);
      setBanner({ ok: true, msg: "Treatment config saved" });
    } catch (err) {
      setBanner({ ok: false, msg: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  if (!practiceId) return <p className="text-sm text-ink/55">No practice selected.</p>;

  return (
    <div className="space-y-5">
      {/* Says what these settings are, and claims nothing about when a change
          reaches the agent. The booking workflow still carries its own copy of
          these values; once it reads them from here, this is where to say so. */}
      <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Live controls.</strong> How {practiceName}&apos;s consultations are set up: who
        offers each treatment, how long the appointment runs, and the deposit taken.
      </div>

      {loadError && (
        <div className="rounded-2xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&apos;t load these settings: {loadError}
        </div>
      )}

      {!ready && !loadError && <p className="text-sm text-ink/55">Loading live config…</p>}

      {ready && !loadError && (
        <TreatmentControls
          treatments={treatments}
          practitioners={practitioners}
          lengthOptions={LENGTH_OPTIONS}
          fixedIds={new Set()}
          banner={banner}
          saving={saving}
          perClinicianLengths
          onChange={setTreatments}
          onSave={save}
        />
      )}
    </div>
  );
}

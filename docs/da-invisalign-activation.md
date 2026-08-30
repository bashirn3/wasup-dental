# Dental Aesthetica — activating Invisalign outbound

Goal: Poppy contacts and books Dental Aesthetica's Invisalign enquiries, without
changing anything about the implant path that is live today.

For DA, Leadflo records these enquiries with type `Ortho`, and the practice has
confirmed that `Ortho` means Invisalign. Both facts matter: the feeder must match
on `Ortho`, and everything patient-facing must say Invisalign.

Execute the steps in order. Each step is independently reversible. Do not skip
ahead: step 7 is the only one that can cause a message to a real patient, and it
is last for that reason.

---

## Non-negotiables

These are what keep the change non-regressive. If a step cannot be done without
breaking one of these, stop and ask.

1. **Implants stay the default.** Every branch added must fall through to today's
   implant values when treatment is absent, unknown, or `implants`.
2. **A config miss for a non-implant treatment must refuse, not fall back.** If a
   tool cannot resolve Invisalign clinicians/length/deposit, it returns an error
   and escalates. It must never book implant clinicians for an Invisalign
   patient. Falling back is safe only in the implant direction.
3. **No live workflow is edited in place.** Export/backup, gate the trigger,
   change, validate, then reactivate with explicit approval (see SOP,
   `doris-bridge/docs/workflow-change-sop.md`).
4. **Secrets stay where they are.** Dentally tokens, the Stripe secret and the
   Supabase service key already live inside the n8n node code. Do not copy them
   into files, commits, or this document.
5. **No caps are raised.** `OUTBOUND_MAX_PER_RUN=1` and `OUTBOUND_MAX_PER_DAY=5`
   remain as they are. Widening pacing is a separate, separately-approved change.
6. **Only Invisalign is activated.** Cosmetic and General stay untracked.

---

## Blocked until the practice answers

Steps 2 onward cannot be completed correctly without these. Do not guess them;
guessing means booking the wrong clinician for a real patient.

| Fact | Needed for |
|---|---|
| Which Dentally practitioners do Invisalign consults, with numeric IDs | availability, save-slot, booking |
| Consult length in minutes, per clinician if they differ | availability, booking |
| Deposit amount, and whether refundable | deposit link, booking, prompt |
| Prices and finance wording | prompt |
| Treatment page URL | prompt, config row |

Steps 0 and 1 can proceed now. Step 1 can be created with the treatment row
present but clinicians empty; the panel will simply show no clinicians selected.

---

## Reference

Systems:

- **Feeder** — repo `leadflo-dashboard`, live at `https://dental-asthetica.wasup.co`,
  Azure App Service `dental-asthetica` in resource group `rapidspec-rg`.
  Auto-deploys on push to `main` via `.github/workflows/deploy-azure.yml`.
- **Dashboard / agent builder** — repo `wasup-dental`, Vercel.
- **n8n** — DA workflows, all currently active:
  - WF-1 Outbound `wvfIm3mvuZu07X3W` (schedule: every 2 minutes, live sends on)
  - WF-2 Inbound `p5fhyvLKjgQchLDy`
  - WF-STRIPE `0Vg72VyDPbvv2lUI`
- **Pattern to copy** — Nuyu, which is already multi-treatment:
  - WF-1 `hkD5MjLOa1Fjmuno`, WF-2 `x8yfboy3xQTZFo5U`.
  - See its `check-dentally-availability`: `resolveTreatmentConfig()` reads a
    stored treatment list and falls back to constants. Copy that shape, not its
    Boxly data source.

Identifiers:

- DA practice id (dashboard Supabase): `6f82214c-6a04-4ee4-bf6e-26dab740521c`
- Booking state table: `dental_aesthetica_leads`, keyed on `number` (digits only)
- Today's implant values, which must remain the fallback: Dr Ahmed Tahboub
  `386136` at 45 minutes (preferred), Dr Adnan Safdar `15185` at 30 minutes,
  £30 refundable deposit, Stripe price lookup key `da_implant_deposit_3000`.

Current outbound gates, for context (read from `/api/health`):
`OUTBOUND_ENABLED=true`, `allowlistOnly=false`, `maxPerRun=1`, `maxPerDay=5`,
`trackedTypes=["implant"]`.

Note that `allowlistOnly=false` means the allowlist is **not** protecting
anything today. Only `TRACKED_TREATMENT_TYPES` is keeping Invisalign leads
unmessaged.

---

## Step 0 — Label Ortho as Invisalign in the dashboard

**Why:** the dashboard currently shows these seven leads as "Orthodontics",
which is wrong for DA. Cheap, no send risk, and it makes later steps legible.

**Change:** `wasup-dental/lib/leadflo-mirror.ts`, in `treatmentFromLeadflo`,
return `invisalign` where it currently returns `ortho`. Update the comment above
the function, which currently states the opposite reasoning.

Leave the `ortho` entry in `TreatmentKey` and `treatmentLabels` alone. Removing
it is unnecessary and would touch unrelated types.

**Only affects DA.** Leadflo feeds DA alone; Regent and Nuyu come through
`boxly-mirror.ts`.

**Verify:** after the next mirror sync, DA leads previously shown as
Orthodontics read as Invisalign, and the treatment breakdown moves those counts.
No lead count changes.

**Rollback:** revert the one line.

**Gate:** normal PR. Do not push straight to `main`.

---

## Step 1 — Add the Invisalign row in the agent builder

**Why:** this is where DA's treatment facts belong, and where step 4 will read
them from.

**Where:** two different tabs of the DA dashboard, both saving through
`/api/agent-config` and both served to n8n by `/api/runtime-config`.

- **Config tab** (`NativeConfigPanel`) — add a treatment row with id
  `invisalign`, name `Invisalign`, the practice's clinician IDs, appointment
  length (per clinician if they differ, via `practitionerLengthMinutes`),
  deposit amount and required flag, and the treatment page URL.
- **Agent tab** (`AgentPanel`, the per-procedure first message) — set the
  approved Invisalign opener, which is stored as
  `treatmentFirstMessages.invisalign`.

Do not touch the existing `implants` row.

**Understand before continuing:** saving this changes no behaviour yet. No DA
workflow reads `/api/runtime-config` today. Step 4 is what makes it live. Say
this plainly to anyone who asks why the agent still talks about implants.

**Verify:** `GET /api/runtime-config?practiceId=6f82214c-6a04-4ee4-bf6e-26dab740521c`
with the `RUNTIME_CONFIG_API_KEY` bearer token returns
`config.clientEditable.treatments` containing both `implants` and `invisalign`,
and `treatmentFirstMessages.invisalign`.

**Rollback:** the config is versioned; revert to the previous version through
`/api/agent-config/versions`.

---

## Step 2 — Carry treatment on the booking row

**Why:** `dental_aesthetica_leads` is keyed on phone number and, as far as the
workflow code shows, has no treatment column. WF-STRIPE therefore cannot know
which treatment it is confirming, so an Invisalign payment would produce an
implant note in Dentally and an implant confirmation message.

**Precondition, unverified:** confirm whether `dental_aesthetica_leads` already
has a `treatment` column. There is no migration file for this table anywhere in
the repos — it was created directly in Supabase. Check the Supabase dashboard
before writing a migration.

**Change:** add nullable `treatment text` (and, if absent, `deposit_amount`)
to `dental_aesthetica_leads`. Nullable is deliberate: existing rows are implant
rows, and null must read as implants.

**Verify:** existing rows unchanged, `treatment` null. No workflow behaviour
changes yet.

**Rollback:** drop the column. Nothing reads it until step 4.

---

## Step 3 — Create the Invisalign Stripe price

**Why:** `create-deposit-link` is pinned to lookup key
`da_implant_deposit_3000` with product name "Dental Aesthetica - Implant
Consultation Deposit". Reusing it for Invisalign would put "Implant Consultation
Deposit" on a real patient's receipt, even if the amount happens to match.

**Change:** create a GBP price with its own lookup key, e.g.
`da_invisalign_deposit_<pence>`, and a product name naming Invisalign. Use the
practice's confirmed deposit amount.

**Verify:** the lookup key resolves to exactly one active price of the expected
amount.

**Rollback:** deactivate the price. Nothing references it until step 4.

**Gate:** this is a change in a live Stripe account. State the amount and
lookup key and get explicit approval before creating it.

---

## Step 4 — Make the six n8n nodes treatment-aware

**Why:** this is the actual behaviour change. Until now nothing sends or books
differently.

**Before any edit** (SOP, non-negotiable 3):

1. Export all three workflows and keep the exports.
2. Deactivate WF-1 `wvfIm3mvuZu07X3W`, or disable its "Every 2 minutes" trigger.
   It is live every two minutes; editing it in place lands mid-run.
3. Record that WF-2 and WF-STRIPE are handling real inbound traffic and real
   payments while you work. Prefer short, validated edits over long ones.
4. Reactivation needs explicit approval.

**Resolution rule for all six nodes.** Resolve treatment once, from
`lead.treatment` (WF-2 already produces this — `Pick latest lead or fallback`
emits `treatment: lead.treatment || 'implants'`) or, in WF-1, from the feeder's
`treatmentType` on the candidate payload. Then look up that key in the treatment
config, following Nuyu's `resolveTreatmentConfig` shape: read the stored config,
fall back to constants.

The fallback constants must be exactly today's implant values. If the key is
`implants`, absent or unknown, behave exactly as now. If the key is `invisalign`
and the config cannot be resolved, **stop and escalate** — do not fall back.

| Workflow | Node | Change |
|---|---|---|
| WF-1 `wvfIm3mvuZu07X3W` | `Build first message` | Pick the opener by treatment. Implant template stays the default for implants/unknown. Note this node's output is also what seeds chat memory, so a wrong opener poisons the conversation too. |
| WF-2 `p5fhyvLKjgQchLDy` | `Build Poppy context` | Select prompt and `treatment_config` by treatment. Today's implant prompt, prices, clinicians and £30 stay verbatim for implants. |
| WF-2 | `check-dentally-availability` | Practitioners and duration from resolved config. Remove the assumption of exactly Ahmed and Adnan. Keep "preferred clinician" behaviour if the practice wants it for Invisalign. |
| WF-2 | `save-chosen-slot` | Accept the resolved treatment's practitioner IDs (currently hard-rejects anything outside `[15185, 386136]`). Write `treatment` and the resolved length and deposit onto the row. |
| WF-2 | `create-deposit-link` | Amount and lookup key from resolved config. Implant path keeps `da_implant_deposit_3000` unchanged. Patient-facing wording must name the right treatment. |
| WF-STRIPE `0Vg72VyDPbvv2lUI` | `book-dentally` | Read `treatment` from the row for the appointment note, the payment amount and the confirmation message. Null reads as implants. |

**Verify with the implant regression checklist below, before step 5.**

**Rollback:** re-import the exports taken above.

---

## Step 5 — Test the inbound, deposit and booking path

This is testable now, with the feeder still implant-only, because WF-2 keys off
the dashboard lead row and an inbound WhatsApp message. The feeder is not
involved.

1. Set your own number's DA lead to `treatment = invisalign`.
2. Purge chat history for that session, then message in.
3. Check: Poppy talks Invisalign, offers Invisalign clinicians and lengths,
   quotes the right deposit, and the deposit link names Invisalign.
4. If you want the Dentally booking proven, that requires a live payment and a
   live appointment. Get explicit approval, use your own number, and cancel the
   appointment afterwards.
5. Repeat once on an implant lead and confirm nothing changed.

**Known limitation, stated so nobody is surprised:** WF-1's Invisalign opener
cannot be exercised through the feeder before step 7, because the feeder refuses
to hand out an untracked treatment. Verify it by dry-run/preview
(`DRY_RUN=true`, or the `Preview candidates` path) and by reading the node, and
accept that the first real Invisalign lead is the live test of the send.

---

## Step 6 — Decide how the first live send is protected

`allowlistOnly` is currently `false`, and `OUTBOUND_ALLOWLIST_ONLY` is not in the
feeder's runtime-overridable keys (`OUTBOUND_ENABLED`, `OUTBOUND_ALLOWLIST`,
`WEBHOOK_URL`). So switching allowlist-only on is itself an Azure environment
change plus a restart.

Choose one, explicitly, with the user:

- **A.** Accept that the first Invisalign lead is a real patient. Justifiable at
  one per run and five per day, once step 5 has passed.
- **B.** Spend the same restart setting `OUTBOUND_ALLOWLIST_ONLY=true` first,
  prove WF-1 on an allowlisted number, then remove it. Costs one extra restart
  and pauses implant outbound while allowlist-only is on — which is itself a
  regression, so it must be time-boxed and announced.

---

## Step 7 — Track Ortho in the feeder

**Last step. This is the one that can message a real patient.**

**Change:** on Azure App Service `dental-asthetica`, set
`TRACKED_TREATMENT_TYPES=Implant,Ortho` and restart.

It must be `Ortho`, not `Invisalign`. Matching requires the configured entry to
be a substring of Leadflo's type, and Leadflo's type for DA is `Ortho`.
`Invisalign` would silently match nothing.

`TRACKED_TREATMENT_TYPES` is read once at import, so a restart is required. It
cannot be set from the dashboard.

**Deploy discipline:** one clean restart. Do not land several merges to `main` in
quick succession — each push triggers a full App Service deploy in a serial
concurrency group, and three in three minutes took the feeder down for about two
hours on 28 August.

**Verify:** `GET /api/health` shows `trackedTypes` containing `ortho`, and
`GET /api/status` shows a recent successful poll with `leadflo.ok = true`.

**Then watch.** Expected volume is roughly one Invisalign enquiry every two to
three days. The contact window is short: observed transitions out of `newLead`
range from 1.4 hours to about a day. WF-1 polls every two minutes, so it will
usually catch them.

**Rollback:** set `TRACKED_TREATMENT_TYPES=Implant` and restart. The feeder
returns to storing Invisalign leads without contacting them. No n8n rollback is
needed, because implants remain the default in every branch.

---

## Implant regression checklist

Run after step 4 and again after step 7. Any "no" stops the rollout.

- An implant lead at `newLead` is still claimed and messaged with the unchanged
  implant opener.
- WF-2 on an implant conversation offers Ahmed (45 min, preferred) and Adnan
  (30 min), and no one else.
- The implant deposit is still £30 and still resolves lookup key
  `da_implant_deposit_3000`.
- A paid implant deposit still books with the same Dentally note, the same
  `30.00` payment and the same confirmation wording.
- `dental_aesthetica_leads` rows with `treatment` null behave exactly as before.
- WF-1's `NEVER_CONTACT` list in `Run config` is intact.
- Feeder caps unchanged: `maxPerRun=1`, `maxPerDay=5`.

---

## Risks to hold in mind

- **The seven existing Invisalign leads are not safe by nature, only by stage.**
  All seven have `outbound_status` null, so the only thing stopping them is
  having moved past the contact stages. If staff move one back to `newLead` or
  `working` after step 7, it becomes eligible immediately. One lead has already
  moved `newLead → working → maybeFuture`, so backwards movement happens.
- **Duplicate phone numbers.** `dental_aesthetica_leads` is keyed on number. A
  patient who enquired about both treatments has one row, so the last saved
  treatment wins. Acceptable for now; know it before debugging a wrong
  confirmation.
- **The feeder has no quiet hours.** WF-1 will send whenever a lead qualifies,
  including evenings and weekends. Unchanged by this work, but Invisalign leads
  arriving at 23:49 have been observed.

## Out of scope

Not messaging the seven existing Invisalign leads. Not copying Nuyu's Boxly
feeder. Not activating Cosmetic or General. Not changing implant clinicians,
lengths or the £30 implant deposit. Not raising pacing caps. Not adding quiet
hours.

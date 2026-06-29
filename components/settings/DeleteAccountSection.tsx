"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { MIcon } from "@/components/mot/icons";

type Props = {
  tenantId: string;
  garageName: string;
  toast: (msg: string) => void;
  variant?: "mobile" | "desktop";
};

export function DeleteAccountSection({ tenantId, garageName, toast, variant = "mobile" }: Props) {
  const { signOut } = useClerk();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const matches = confirm.trim().toLowerCase() === garageName.trim().toLowerCase();
  const clerkOn = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  const deleteAccount = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, confirmName: confirm.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "confirm_mismatch") toast("Garage name doesn't match — try again");
        else toast("Couldn't delete account — try again");
        return;
      }
      toast("Account deleted");
      if (clerkOn) {
        await signOut({ redirectUrl: "/" });
      } else {
        window.location.href = "/";
      }
    } catch {
      toast("Couldn't delete account — try again");
    } finally {
      setBusy(false);
    }
  };

  const cardClass = variant === "desktop" ? "set-card" : "card";
  const padding = variant === "desktop" ? undefined : { padding: "18px 16px" };

  return (
    <div className={cardClass} style={{ ...padding, borderColor: open ? "var(--danger)" : undefined }}>
      <div className="set-title" style={{ color: "var(--danger)" }}>
        Delete account
      </div>
      <div className="set-sub" style={{ marginTop: 6 }}>
        Permanently removes your garage, leads, bookings, WhatsApp instance, and sign-in. This cannot be undone.
      </div>

      {!open ? (
        <button
          className="btn btn-ghost"
          style={{ marginTop: 14, color: "var(--danger)", width: variant === "desktop" ? "auto" : "100%" }}
          onClick={() => setOpen(true)}
        >
          Delete my account…
        </button>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="t-sub" style={{ margin: 0 }}>
            Type <strong>{garageName}</strong> to confirm:
          </p>
          <label className="field">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={garageName}
              autoComplete="off"
              aria-label="Confirm garage name"
            />
          </label>
          <div className="row" style={{ gap: 9 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setOpen(false); setConfirm(""); }} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, background: "var(--danger)", borderColor: "var(--danger)" }}
              disabled={!matches || busy}
              onClick={() => void deleteAccount()}
            >
              {busy ? <MIcon.refresh size={16} className="spin" /> : "Delete forever"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

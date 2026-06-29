"use client";

import { useCallback, useEffect, useState } from "react";
import { MIcon } from "./icons";
import { WhatsAppConnectPanel } from "@/components/connect/WhatsAppConnectPanel";
import { displayWaPhone } from "@/lib/wa-sheet-logic";

type Props = {
  tenantId: string;
  garageName?: string;
  instanceId: string | null;
  phone: string;
  closing: boolean;
  onClose: () => void;
  toast: (msg: string) => void;
  onStatus: (connected: boolean) => void;
  onRefresh: () => void;
};

type ConnectIntent = "reconnect" | "new" | "change";
type PendingAction = "disconnect" | "change" | null;

export function WaSheet({
  tenantId,
  garageName,
  instanceId,
  phone,
  closing,
  onClose,
  toast,
  onStatus,
  onRefresh,
}: Props) {
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [connectIntent, setConnectIntent] = useState<ConnectIntent | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!instanceId) {
      setStatus("disconnected");
      onStatus(false);
      return;
    }
    setStatus("checking");
    try {
      const res = await fetch(
        `/api/wasup/status?instanceId=${encodeURIComponent(instanceId)}&tenantId=${encodeURIComponent(
          tenantId,
        )}&mode=qr&phone=${encodeURIComponent(phone)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setStatus("disconnected");
        onStatus(false);
        return;
      }
      const data = await res.json();
      const connected = data.status === "connected";
      setStatus(connected ? "connected" : "disconnected");
      onStatus(connected);
    } catch {
      setStatus("disconnected");
      onStatus(false);
    }
  }, [instanceId, onStatus, phone, tenantId]);

  useEffect(() => {
    const t = window.setTimeout(() => void checkStatus(), 0);
    return () => clearTimeout(t);
  }, [checkStatus]);

  const runDisconnect = async (changeNumber: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/wasup/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, changeNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "wasup_clear_failed" || data.error === "wasup_delete_failed") {
          toast("Couldn't reach Wasup to disconnect — try again in a moment");
        } else {
          toast(changeNumber ? "Couldn't change number — try again" : "Couldn't disconnect — try again");
        }
        return;
      }
      onRefresh();
      onStatus(false);
      setStatus("disconnected");
      setPendingAction(null);
      if (changeNumber) {
        toast("WhatsApp unlinked — enter your new number");
        setConnectIntent("change");
      } else {
        toast("WhatsApp disconnected");
      }
    } catch {
      toast(changeNumber ? "Couldn't change number — try again" : "Couldn't disconnect — try again");
    } finally {
      setBusy(false);
    }
  };

  const openConnect = (intent: ConnectIntent) => setConnectIntent(intent);

  const openChangeNumber = () => {
    if (status === "connected") {
      setPendingAction("change");
      return;
    }
    setConnectIntent("change");
  };

  if (connectIntent) {
    const panelPhone =
      connectIntent === "reconnect" ? phone : "";
    return (
      <>
        <div className={"scrim" + (closing ? " closing" : "")} onClick={onClose} />
        <div
          className={"sheet" + (closing ? " closing" : "")}
          style={{ padding: 0, overflow: "hidden", maxHeight: "92dvh", display: "flex", flexDirection: "column" }}
        >
          <WhatsAppConnectPanel
            key={connectIntent}
            tenantId={tenantId}
            practiceName={garageName}
            initialPhone={panelPhone}
            reconnectInstanceId={connectIntent === "reconnect" ? instanceId : null}
            forcePhoneStep={connectIntent === "change" || connectIntent === "new" || connectIntent === "reconnect"}
            fixedLinkMode="code"
            variant="embedded"
            onBack={() => {
              setConnectIntent(null);
              void checkStatus();
            }}
            doneLabel="Done"
            onConnected={() => {
              onRefresh();
              onStatus(true);
              setStatus("connected");
              setConnectIntent(null);
            }}
          />
        </div>
      </>
    );
  }

  if (pendingAction) {
    const isChange = pendingAction === "change";
    return (
      <>
        <div className={"scrim" + (closing ? " closing" : "")} onClick={onClose} />
        <div className={"sheet" + (closing ? " closing" : "")}>
          <div className="sheet-grip" />
          <div className="row-between" style={{ padding: "8px 14px 0 22px" }}>
            <h2 className="t-h2">{isChange ? "Change number?" : "Disconnect?"}</h2>
            <button className="iconbtn" onClick={() => setPendingAction(null)} aria-label="Back">
              <MIcon.back size={20} />
            </button>
          </div>
          <div style={{ padding: "24px 22px 8px" }}>
            <p className="t-sub" style={{ margin: 0, lineHeight: 1.55 }}>
              {isChange
                ? "This logs out WhatsApp, removes the current instance, and clears the linked number. You'll pair a new number next."
                : "This logs out WhatsApp on the server. Your instance stays — scan again anytime to reconnect."}
            </p>
            <div className="mono" style={{ fontSize: 13, color: "var(--muted)", marginTop: 14 }}>
              {displayWaPhone(phone)}
            </div>
          </div>
          <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              className="btn btn-primary"
              style={isChange ? { background: "var(--danger)", borderColor: "var(--danger)" } : undefined}
              disabled={busy}
              onClick={() => void runDisconnect(isChange)}
            >
              {busy ? <MIcon.refresh size={17} className="spin" /> : isChange ? "Yes, change number" : "Yes, disconnect"}
            </button>
            <button className="btn btn-ghost" onClick={() => setPendingAction(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={"scrim" + (closing ? " closing" : "")} onClick={onClose} />
      <div className={"sheet" + (closing ? " closing" : "")}>
        <div className="sheet-grip" />
        <div className="row-between" style={{ padding: "8px 14px 0 22px" }}>
          <h2 className="t-h2">WhatsApp</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <MIcon.close size={20} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "0 32px",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: status === "connected" ? "var(--tint)" : "var(--danger-bg)",
              color: status === "connected" ? "var(--pine)" : "var(--danger)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            {status === "checking" ? (
              <MIcon.refresh size={26} s={2} className="spin" />
            ) : status === "connected" ? (
              <MIcon.check size={30} s={2.2} />
            ) : (
              <MIcon.close size={28} s={2.2} />
            )}
          </div>
          <div style={{ fontSize: 19, fontWeight: 600 }}>
            {!instanceId
              ? "Setup required"
              : status === "checking"
                ? "Checking…"
                : status === "connected"
                  ? "Connected"
                  : "Not connected"}
          </div>
          <div className="mono" style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 8 }}>
            {instanceId ? displayWaPhone(phone) : "Link WhatsApp to send and receive lead messages"}
          </div>
        </div>

        <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          {instanceId ? (
            <>
              <button className="btn btn-primary" onClick={() => openConnect("reconnect")} disabled={busy}>
                Reconnect
              </button>
              <button className="btn btn-ghost" onClick={openChangeNumber} disabled={busy}>
                Change number
              </button>
              {(status === "connected" || phone) && (
                <button className="btn btn-ghost" onClick={() => setPendingAction("disconnect")} disabled={busy}>
                  Disconnect
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => openConnect("new")}>
              Connect WhatsApp
            </button>
          )}
        </div>
      </div>
    </>
  );
}

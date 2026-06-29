"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp, type ScanFinishRow } from "./context";
import type { ScanRow } from "@/lib/scan/types";

type Page = {
  id: number;
  pageIndex: number;
  status: "scanning" | "done" | "error";
  rows: ScanFinishRow[];
  thumb: string | null;
};

const SCAN_ACCEPT = "image/png,image/jpeg,.png,.jpg,.jpeg";

let pageId = 0;

function isScanImage(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg") return true;
  return /\.(png|jpe?g)$/i.test(file.name || "");
}

async function requestCameraStream(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    { video: { facingMode: "user" }, audio: false },
    { video: true, audio: false },
  ];
  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function bindStream(video: HTMLVideoElement, stream: MediaStream) {
  if (video.srcObject !== stream) video.srcObject = stream;
  void video.play().catch(() => undefined);
}

function ScanStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="sr-stat">
      <span className="sr-stat-num">{n}</span>
      <span className="sr-stat-lbl">{label}</span>
    </div>
  );
}

function ScanThumb({
  page,
  onRemove,
}: {
  page: Page;
  onRemove: () => void;
}) {
  const leadCount = page.status === "done" ? page.rows.length : 0;

  return (
    <div className="sr-thumb" style={page.thumb ? { backgroundImage: `url(${page.thumb})` } : undefined}>
      <div className="sr-thumb-lines" aria-hidden>
        <span className="sr-ln a" />
        <span className="sr-ln b" />
        <span className="sr-ln c" />
        <span className="sr-ln d" />
        <span className="sr-ln e" />
      </div>

      {page.status === "scanning" && (
        <div className="sr-thumb-scanning">
          <div className="sr-thumb-spinner" />
        </div>
      )}

      {page.status === "done" && leadCount === 0 && (
        <div className="sr-thumb-check" aria-label="Scanned">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6.3l2.2 2.2L9.5 3.6" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {page.status === "done" && leadCount > 0 && (
        <div className="sr-thumb-leadpill">
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="#fff" strokeWidth={1.5} />
            <circle cx="6" cy="6" r="1.6" fill="#fff" />
          </svg>
          <span>{leadCount}</span>
        </div>
      )}

      {page.status === "error" && (
        <div className="sr-thumb-err" aria-label="Scan failed">
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2l-6 6" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        </div>
      )}

      <button type="button" className="sr-thumb-remove" onClick={onRemove} aria-label="Remove page">
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
          <path d="M2 2l6 6M8 2l-6 6" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Mobile register scanner — camera viewfinder + bottom sheet.
 * Pages go to /api/scan (vision). Lead counts roll up per thumbnail and in the header.
 */
export function ScanScreen() {
  const { closeScan, finishScan, toast } = useApp();
  const [pages, setPages] = useState<Page[]>([]);
  const [flashOpacity, setFlashOpacity] = useState(0);
  const [torch, setTorch] = useState(false);
  const [camera, setCamera] = useState<"idle" | "starting" | "live" | "unavailable">("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbsRef = useRef<string[]>([]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageIndexRef = useRef(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera("idle");
    setTorch(false);
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera("unavailable");
      return;
    }
    let cancelled = false;
    setCamera("starting");
    (async () => {
      try {
        const stream = await requestCameraStream();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCamera("live");
      } catch {
        if (!cancelled) setCamera("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (camera !== "live") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) bindStream(video, stream);
  }, [camera]);

  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [pages]);

  useEffect(() => {
    const thumbs = thumbsRef.current;
    return () => {
      stopCamera();
      if (flashTimer.current) clearTimeout(flashTimer.current);
      thumbs.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [stopCamera]);

  const fireFlash = useCallback(() => {
    setFlashOpacity(0.85);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashOpacity(0), 130);
  }, []);

  const processBlob = useCallback(
    (blob: Blob, thumb: string | null) => {
      const id = ++pageId;
      const pageIndex = pageIndexRef.current++;
      if (thumb) thumbsRef.current.push(thumb);
      setPages((p) => [...p, { id, pageIndex, status: "scanning", rows: [], thumb }]);
      fireFlash();

      const form = new FormData();
      form.append("file", blob, "page.jpg");
      fetch("/api/scan", { method: "POST", body: form })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            if (data.error === "unsupported_format") throw new Error("format");
            throw new Error(data.error ?? "scan_failed");
          }
          const rows = ((data.rows ?? []) as ScanRow[]).map((r, rowIndex) => ({
            name: r.name,
            plate: r.plate,
            phone: r.phone,
            pageIndex,
            rowIndex: typeof r.rowIndex === "number" ? r.rowIndex : rowIndex,
          }));
          setPages((p) => p.map((pg) => (pg.id === id ? { ...pg, status: "done", rows } : pg)));
        })
        .catch((err) => {
          setPages((p) => p.map((pg) => (pg.id === id ? { ...pg, status: "error" } : pg)));
          toast(
            err instanceof Error && err.message === "format"
              ? "PNG or JPG only"
              : "Couldn't read that page — try a sharper shot",
          );
        });
    },
    [fireFlash, toast],
  );

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (camera !== "live" || !video || video.videoWidth === 0) {
      toast("Camera not ready — try upload instead");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        processBlob(blob, URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.88,
    );
  }, [camera, processBlob, toast]);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    let added = 0;
    [...files].slice(0, 12).forEach((file) => {
      if (!isScanImage(file)) return;
      processBlob(file, URL.createObjectURL(file));
      added++;
    });
    if (added === 0) toast("Use PNG or JPG page images only");
    if (fileRef.current) fileRef.current.value = "";
  };

  const removePage = (id: number) => {
    setPages((p) => {
      const removed = p.find((pg) => pg.id === id);
      if (removed?.thumb) {
        URL.revokeObjectURL(removed.thumb);
        thumbsRef.current = thumbsRef.current.filter((u) => u !== removed.thumb);
      }
      return p.filter((pg) => pg.id !== id);
    });
  };

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      setTorch(next);
    }
  }, [torch]);

  const captured = pages.length;
  const leadsFound = pages.reduce((n, p) => n + (p.status === "done" ? p.rows.length : 0), 0);
  const scanning = pages.filter((p) => p.status === "scanning").length;
  const allRows = () =>
    pages
      .slice()
      .sort((a, b) => a.pageIndex - b.pageIndex)
      .flatMap((p) => p.rows.slice().sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0)));

  const handleDone = () => {
    finishScan(allRows(), leadsFound > 0);
  };

  return (
    <div className="sr-layer">
      <input
        ref={fileRef}
        type="file"
        accept={SCAN_ACCEPT}
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />

      {/* camera viewfinder */}
      <div className="sr-stage">
        <video
          ref={videoRef}
          className={"sr-video" + (camera === "live" ? "" : " hidden")}
          playsInline
          muted
          autoPlay
        />
        <div className="sr-vignette" />
        <div
          className="sr-flash"
          style={{ opacity: flashOpacity, transition: "opacity .16s ease" }}
        />

        <button type="button" className="sr-icon-btn sr-close" onClick={closeScan} aria-label="Close">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M5 5l14 14M19 5L5 19" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
          </svg>
        </button>
        <div className="sr-title">SCAN REGISTER</div>
        <button
          type="button"
          className="sr-icon-btn sr-flash-btn"
          onClick={() => void toggleTorch()}
          aria-label="Toggle flash"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M13 2L4 13h6l-1 9 9-11h-6l1-9z"
              stroke={torch ? "#2FAE6B" : "#fff"}
              strokeWidth={1.8}
              strokeLinejoin="round"
              fill={torch ? "#2FAE6B" : "none"}
            />
          </svg>
        </button>

        <div className="sr-bracket tl" />
        <div className="sr-bracket tr" />
        <div className="sr-bracket bl" />
        <div className="sr-bracket br" />

        <div className="sr-cam-hint">
          {camera === "starting" ? (
            "Starting camera…"
          ) : camera === "unavailable" ? (
            <>
              Camera unavailable — use Upload below
            </>
          ) : (
            "Point at a page and tap the shutter"
          )}
        </div>
      </div>

      {/* bottom sheet */}
      <div className="sr-sheet">
        <div className="sr-grabber" />

        <div className="sr-sheet-head">
          <div className="sr-stats">
            <ScanStat n={captured} label="captured" />
            <div className="sr-stat-div" />
            <ScanStat n={leadsFound} label="leads found" />
          </div>
          <button
            type="button"
            className="sr-done-btn"
            disabled={captured === 0}
            onClick={handleDone}
          >
            {scanning > 0 ? `Done · ${scanning} scanning` : "Done"}
          </button>
        </div>

        <div className="sr-strip-wrap">
          {captured === 0 ? (
            <p className="sr-strip-hint">
              Tap the shutter for every page — keep shooting, they scan in the background.
            </p>
          ) : (
            <div ref={stripRef} className="sr-strip">
              {pages.map((pg) => (
                <ScanThumb key={pg.id} page={pg} onRemove={() => removePage(pg.id)} />
              ))}
            </div>
          )}
        </div>

        <div className="sr-controls">
          <button type="button" className="sr-ctrl sr-upload" onClick={() => fileRef.current?.click()}>
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
              <path d="M12 16V4M12 4l-4 4M12 4l4 4" stroke="#0b3020" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" stroke="#0b3020" strokeWidth={1.9} strokeLinecap="round" />
            </svg>
            <span>Upload</span>
          </button>

          <button type="button" className="sr-shutter" onClick={capture} aria-label="Capture page">
            <span />
          </button>

          <div className="sr-ctrl-spacer" />
        </div>
      </div>
    </div>
  );
}

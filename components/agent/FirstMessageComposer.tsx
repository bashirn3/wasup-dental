"use client";

import { useEffect, useRef } from "react";
import { FIRST_MESSAGE_VARIABLES } from "@/lib/first-message-vars";

const VARIABLES = FIRST_MESSAGE_VARIABLES;

function labelFor(token: string): string {
  return VARIABLES.find((v) => v.token === token)?.label ?? token;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline green block for a dynamic variable, non-editable so it behaves atomically. */
function chipHtml(token: string): string {
  const label = escapeHtml(labelFor(token));
  return (
    `<span data-token="${token}" contenteditable="false" ` +
    `style="display:inline-block;background:#C8F23C;color:#0B241C;border-radius:6px;` +
    `padding:0 7px;margin:0 1px;font-weight:700;font-size:13px;line-height:1.7;` +
    `white-space:nowrap;vertical-align:baseline;">${label}</span>`
  );
}

const TOKEN_RE = /(\{\{[a-z_]+\}\})/g;

function templateToHtml(template: string): string {
  if (!template) return "";
  return template
    .split(TOKEN_RE)
    .map((part) => {
      if (/^\{\{[a-z_]+\}\}$/.test(part) && VARIABLES.some((v) => v.token === part)) {
        return chipHtml(part);
      }
      return escapeHtml(part).replace(/\n/g, "<br>");
    })
    .join("");
}

function domToTemplate(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
    } else if (node.nodeName === "BR") {
      out += "\n";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement;
      const tok = e.getAttribute("data-token");
      if (tok) out += tok;
      else out += domToTemplate(e);
    }
  });
  return out;
}

type Props = {
  value: string;
  onChange: (template: string) => void;
  placeholder?: string;
  /** Agent tweak tab: 3-line bubble with generous WhatsApp wallpaper padding */
  tweakLayout?: boolean;
};

/**
 * WhatsApp-style first-message editor. Variable chips insert {{tokens}} that
 * render inline as green blocks; the serialized value keeps the {{token}} form.
 */
export default function FirstMessageComposer({
  value,
  onChange,
  placeholder,
  tweakLayout,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastSerialized = useRef<string>("\u0000");

  // Only write to the DOM when value changed externally (mount, version restore),
  // never on our own keystrokes — that would reset the caret.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === lastSerialized.current) return;
    el.innerHTML = templateToHtml(value);
    lastSerialized.current = value;
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const t = domToTemplate(el);
    lastSerialized.current = t;
    onChange(t);
  };

  const insertToken = (token: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    let range: Range;
    if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
      range.deleteContents();
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    const tpl = document.createElement("template");
    tpl.innerHTML = chipHtml(token) + "\u00A0";
    const frag = tpl.content;
    const lastNode = frag.lastChild;
    range.insertNode(frag);
    if (lastNode && sel) {
      const after = document.createRange();
      after.setStartAfter(lastNode);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    emit();
  };

  return (
    <div>
      <p className="mb-2 text-xs text-[#9DB3A7]">Tap to drop a dynamic value into the message:</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            onClick={() => insertToken(v.token)}
            className="h-8 rounded-full border border-[#C8F23C]/40 bg-[#C8F23C]/[0.15] px-3 text-xs font-semibold text-[#C8F23C] transition hover:bg-[#C8F23C]/[0.25] active:scale-95"
          >
            {v.label}
          </button>
        ))}
      </div>
      <div
        className={`rounded-xl bg-[#EFE7DC] bg-[url('/whatsapp-chat-bg.jpg')] bg-[length:380px_auto] ${
          tweakLayout ? "p-4" : "p-3.5"
        }`}
      >
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          data-placeholder={placeholder ?? "Hi {{name}}! Your MOT is due {{in_days}}…"}
          className={`rm-fm-editor max-w-[92%] rounded-[10px] rounded-tl-[3px] bg-white px-3 text-sm leading-[1.5] text-[#111B21] shadow-[0_1px_1px_rgba(0,0,0,0.10)] outline-none ${
            tweakLayout ? "min-h-[78px] py-2.5" : "min-h-[84px] py-2.5"
          }`}
        />
      </div>
    </div>
  );
}

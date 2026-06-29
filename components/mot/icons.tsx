"use client";

import type { CSSProperties, ReactNode } from "react";

type IconProps = {
  d?: ReactNode;
  s?: number;
  size?: number;
  style?: CSSProperties;
  className?: string;
};

const MI = ({ d, s = 1.8, size = 22, style, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={s}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ display: "block", flex: "0 0 auto", ...style }}
  >
    {d}
  </svg>
);

type P = Omit<IconProps, "d">;

/* Icon set ported verbatim from app-rest.html (mot-ui.jsx). */
export const MIcon = {
  users: (p: P) => (
    <MI {...p} d={<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" /><path d="M16 5.3a3.2 3.2 0 010 5.6M17 14.6c2.4.5 3.8 2.4 3.8 5.4" /></>} />
  ),
  chat: (p: P) => (
    <MI {...p} d={<path d="M21 11.5a8.5 8.5 0 01-8.5 8.5c-1.5 0-2.9-.37-4.1-1L4 20l1.05-4.2A8.5 8.5 0 1121 11.5z" />} />
  ),
  gear: (p: P) => (
    <MI
      {...p}
      d={
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </>
      }
    />
  ),
  cam: (p: P) => (
    <MI {...p} d={<><path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z" /><circle cx="12" cy="13" r="3.4" /></>} />
  ),
  upload: (p: P) => (
    <MI {...p} d={<><path d="M12 15V4M7.5 8L12 3.5 16.5 8" /><path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" /></>} />
  ),
  check: (p: P) => <MI {...p} d={<path d="M4 12.5l5 5L20 6" />} />,
  chev: (p: P) => <MI {...p} d={<path d="M9 5l7 7-7 7" />} />,
  back: (p: P) => <MI {...p} d={<path d="M15 4l-8 8 8 8" />} />,
  refresh: (p: P) => <MI {...p} d={<path d="M20 11a8 8 0 10-1.5 5.5M20 4v5h-5" />} />,
  clock: (p: P) => (
    <MI {...p} d={<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>} />
  ),
  mail: (p: P) => (
    <MI {...p} d={<><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M4 8l8 5.5L20 8" /></>} />
  ),
  plus: (p: P) => <MI {...p} d={<path d="M12 5v14M5 12h14" />} />,
  minus: (p: P) => <MI {...p} d={<path d="M5 12h14" />} />,
  send: (p: P) => <MI {...p} d={<path d="M21 3L10.5 13.5M21 3l-6.5 18-4-8.5L2 8.5 21 3z" />} />,
  bolt: (p: P) => <MI {...p} d={<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />} />,
  clip: (p: P) => (
    <MI {...p} d={<><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3.5" /></>} />
  ),
  shield: (p: P) => (
    <MI {...p} d={<><path d="M12 3l7.5 3v5.5c0 4.8-3.2 8-7.5 9.5-4.3-1.5-7.5-4.7-7.5-9.5V6z" /><path d="M9 12l2 2 4-4" /></>} />
  ),
  car: (p: P) => (
    <MI {...p} d={<><path d="M3 13l2-5.5A2 2 0 016.9 6h10.2a2 2 0 011.9 1.5L21 13v5h-3v-2H6v2H3z" /><circle cx="7" cy="16" r="1.4" fill="currentColor" stroke="none" /><circle cx="17" cy="16" r="1.4" fill="currentColor" stroke="none" /></>} />
  ),
  phone: (p: P) => (
    <MI {...p} d={<path d="M5 3.5h4l2 5-2.5 1.5a12 12 0 005 5L16 13l5 2v4a2 2 0 01-2 2A16.5 16.5 0 013 5.5a2 2 0 012-2z" />} />
  ),
  spark: (p: P) => (
    <MI {...p} d={<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></>} />
  ),
  close: (p: P) => <MI {...p} d={<path d="M6 6l12 12M18 6L6 18" />} />,
  cal: (p: P) => (
    <MI {...p} d={<><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 2.5V6M16 2.5V6" /></>} />
  ),
  file: (p: P) => (
    <MI {...p} d={<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></>} />
  ),
  ticks: (p: P) => (
    <MI {...p} d={<><path d="M1.5 12.5l4 4L13 9" /><path d="M9.5 14.5l2 2L19 9" /></>} />
  ),
  trash: (p: P) => (
    <MI {...p} d={<><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>} />
  ),
  rows: (p: P) => <MI {...p} d={<path d="M4 6h16M4 12h16M4 18h10" />} />,
};

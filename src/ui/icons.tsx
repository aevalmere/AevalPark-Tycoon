import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

const solid = (d: string) => (p: P) => (
  <svg viewBox="0 0 24 24" width={p.size ?? 18} height={p.size ?? 18} fill="currentColor" aria-hidden="true" className={p.className}>
    <path d={d} />
  </svg>
);

export const Icon = {
  Crown: (p: P) => (
    <svg viewBox="0 0 64 64" width={p.size ?? 18} height={p.size ?? 18} aria-hidden="true" className={p.className}>
      <path d="M13 44 L13 25 L23.5 33.5 L32 19 L40.5 33.5 L51 25 L51 44 Z" fill="#E8A33D" />
      <rect x="13" y="47" width="38" height="4.5" rx="2.25" fill="#E8A33D" />
      <circle cx="13" cy="22" r="3" fill="#F2C979" />
      <circle cx="32" cy="16" r="3" fill="#F2C979" />
      <circle cx="51" cy="22" r="3" fill="#F2C979" />
    </svg>
  ),
  Pointer: (p: P) => <Svg {...p}><path d="M4 3l7 17 2.5-7.5L21 10z" /></Svg>,
  Taxi: solid('M18.92 6.01C18.72 5.42 18.16 5 17.5 5H15V3H9v2H6.5c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z'),
  Car: solid('M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z'),
  Parking: (p: P) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M9 17V7h4a3 3 0 0 1 0 6H9" /></Svg>,
  Key: solid('M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z'),
  Road: (p: P) => <Svg {...p}><path d="M5 21 9 3M19 21 15 3M12 4v2M12 10v3M12 17v3" /></Svg>,
  Bulldoze: (p: P) => <Svg {...p}><path d="M3 17h11v-5H7l-2 5M14 12h3l3 3v2h-6M2 21h20" /><circle cx="6" cy="19" r="1" /><circle cx="17" cy="19" r="1" /></Svg>,
  Play: (p: P) => <Svg {...p}><path d="M7 4v16l13-8z" fill="currentColor" /></Svg>,
  Pause: (p: P) => <Svg {...p}><path d="M8 5v14M16 5v14" /></Svg>,
  Fast: (p: P) => <Svg {...p}><path d="M4 5v14l8-7zM12 5v14l8-7z" fill="currentColor" /></Svg>,
  Plus: (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  Minus: (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>,
  Folder: (p: P) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>,
  Code: (p: P) => <Svg {...p}><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></Svg>,
  Help: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01" /></Svg>,
  Gear: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>,
  Star: solid('M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z'),
  Trophy: (p: P) => <Svg {...p}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></Svg>,
  Chart: (p: P) => <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>,
  Menu: (p: P) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>,
  Close: (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  Locate: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></Svg>,
  Search: (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>,
  Copy: (p: P) => <Svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Svg>,
  Trash: (p: P) => <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></Svg>,
  Save: (p: P) => <Svg {...p}><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M7 3v6h8V3M7 21v-7h10v7" /></Svg>,
  Expand: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" strokeDasharray="3 3" /></Svg>,
  Layers: (p: P) => <Svg {...p}><path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" /></Svg>,
  Users: (p: P) => <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></Svg>,
  Sun: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>,
  Moon: (p: P) => <Svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Svg>,
  ArrowUp: (p: P) => <Svg {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Svg>,
  Pin: (p: P) => <Svg {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></Svg>,
  Target: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></Svg>,
  Dice: (p: P) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1" fill="currentColor" /><circle cx="15.5" cy="8.5" r="1" fill="currentColor" /><circle cx="8.5" cy="15.5" r="1" fill="currentColor" /></Svg>,
  Exit: (p: P) => <Svg {...p}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></Svg>,
  Undo: (p: P) => <Svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Svg>,
  Trend: (p: P) => <Svg {...p}><path d="m6 15 6-6 6 6" /></Svg>,
};

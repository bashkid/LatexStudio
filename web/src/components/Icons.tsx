const P: Record<string, string[]> = {
  sparkles: ["M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z", "M19 15l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"],
  play: ["M7 4.5l12 7.5-12 7.5z"],
  copy: ["M9 9h11v11H9z", "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"],
  check: ["M5 12.5l4.5 4.5L19 7"],
  undo: ["M9 14L4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  redo: ["M15 14l5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  type: ["M4 7V4h16v3", "M9 20h6", "M12 4v16"],
  bold: ["M6 4h8a4 4 0 0 1 0 8H6z", "M6 12h9a4 4 0 0 1 0 8H6z"],
  italic: ["M19 4h-9", "M14 20H5", "M15 4L9 20"],
  sigma: ["M18 7V5H6l6 7-6 7h12v-2"],
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  tag: ["M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4z", "M7 7h.01"],
  book: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z", "M4 19.5V21h16"],
  image: ["M3 5h18v14H3z", "M3 16l5-5 4 4 3-3 6 6", "M8.5 9.5h.01"],
  table: ["M3 3h18v18H3z", "M3 9h18", "M3 15h18", "M9 3v18", "M15 3v18"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M21 21l-4.3-4.3"],
  pencil: ["M17 3l4 4L7 21H3v-4z"],
  eye: ["M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  message: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  sidebar: ["M3 3h18v18H3z", "M9 3v18"],
  left: ["M15 18l-6-6 6-6"], right: ["M9 18l6-6-6-6"], up: ["M18 15l-6-6-6 6"], down: ["M6 9l6 6 6-6"],
  minus: ["M5 12h14"], plus: ["M12 5v14", "M5 12h14"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M8 13h8", "M8 17h8"],
  arrowRight: ["M5 12h14", "M12 5l7 7-7 7"], arrowLeft: ["M19 12H5", "M12 19l-7-7 7-7"],
  chevronDown: ["M6 9l6 6 6-6"], close: ["M18 6L6 18", "M6 6l12 12"], save: ["M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z", "M17 21v-8H7v8", "M7 3v5h8"],
  save2: ["M20 6L9 17l-5-5"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
};

/** A small stroke icon (24-unit grid, drawn with the current text colour). */
export default function Icon({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true" focusable="false">
      {(P[name] ?? []).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

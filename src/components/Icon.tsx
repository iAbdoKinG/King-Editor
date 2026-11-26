/** Minimal stroke icon set (24px grid, 1.75 stroke) — no icon library dependency. */
const P: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  stepBack: 'M18 6v12l-8-6zM6 6v12',
  stepFwd: 'M6 6v12l8-6zM18 6v12',
  toStart: 'M19 6v12l-9-6zM6 6v12',
  prevEdit: 'M20 7v10l-7-5zM11 4v16M4 9l3 3-3 3',
  nextEdit: 'M4 7v10l7-5zM13 4v16M20 9l-3 3 3 3',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  export: 'M12 15V3M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5',
  split: 'M12 3v18M8 7H4v10h4M16 7h4v10h-4',
  duplicate: 'M8 8h11v11H8zM5 16V5h11',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  plus: 'M12 5v14M5 12h14',
  media: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  focus: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M6 6l12 12M18 6 6 18',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 5M22 9l-5 5',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6M11 8v6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
  fullscreen: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15.5 9a1.5 1.5 0 1 0 0-.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  gauge: 'M12 14l4-4M3.5 17a9 9 0 1 1 17 0',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.2-1.6-.4-.9.2-1.9 1.2-1.9H17a4 4 0 0 0 4-4c0-5-4-10.5-9-10.5zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  wand: 'M15 4V2M15 10V8M11 6H9M21 6h-2M17.8 8.8 19 10M17.8 3.2 19 2M12.2 3.2 11 2M3 21l9-9M14 6l1 1',
  flipH: 'M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z',
  flipV: 'M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  windows: 'M3 5.5 10.5 4.5v7H3zM12 4.3 21 3v8.5h-9zM3 12.5h7.5v7L3 18.5zM12 12.5h9V21l-9-1.3z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h10',
  home: 'M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  ripple: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M21 17h-3',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const filled = name === 'play';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.25 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={P[name]} />
    </svg>
  );
}

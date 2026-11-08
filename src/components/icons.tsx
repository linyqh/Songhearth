// Hand-drawn sidebar glyphs (SF Symbols–like proportions). Stroke uses
// currentColor so icons always match the label text colour.

interface IconProps {
  size?: number;
}

function Svg({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Create: quill tip with a small sparkle. */
export function IconCreate(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20c1.2-4.6 3.6-8.4 7.4-11.2L15 6.2l2.8 2.8-2.6 3.6C12.4 16.4 8.6 18.8 4 20Z" />
      <path d="M4 20l5.2-5.2" />
      <path d="M18.5 2.8v3.4M16.8 4.5h3.4" />
    </Svg>
  );
}

/** My Songs: stacked list ending in a music note. */
export function IconWorks(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 6h11M3.5 11h11M3.5 16h6" />
      <path d="M18.5 4.5v11" />
      <path d="M18.5 4.5l2.5 1.2" />
      <circle cx="16.4" cy="16.4" r="2.2" />
    </Svg>
  );
}

/** Models: isometric cube. */
export function IconModels(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2l8-4.4Z" />
      <path d="M4.2 7.3L12 11.6l7.8-4.3" />
      <path d="M12 11.6v9.4" />
    </Svg>
  );
}

/** API & Skill: angle brackets around a slash. */
export function IconApi(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7.5 7L3 12l4.5 5" />
      <path d="M16.5 7L21 12l-4.5 5" />
      <path d="M13.6 5.5l-3.2 13" />
    </Svg>
  );
}

/** Settings: gear. */
export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8l1.6 2.3 2.7-.7.8 2.7 2.7.8-.7 2.7 2.3 1.4-2.3 1.4.7 2.7-2.7.8-.8 2.7-2.7-.7L12 21.2l-1.6-2.3-2.7.7-.8-2.7-2.7-.8.7-2.7L2.6 12l2.3-1.4-.7-2.7 2.7-.8.8-2.7 2.7.7L12 2.8Z" />
    </Svg>
  );
}

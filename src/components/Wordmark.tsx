/** Songhearth wordmark: flowing script lettering with a warm hearth-glow
 *  gradient, a staff-line swash underneath and a glowing note-flame dot. */
export function Wordmark() {
  return (
    <svg className="wordmark" viewBox="0 0 196 50" role="img" aria-label="Songhearth">
      <defs>
        <linearGradient id="wm-fill" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#ff7a45" />
          <stop offset="0.5" stopColor="#ff4f8b" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="wm-swash" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff7a45" stopOpacity="0" />
          <stop offset="0.25" stopColor="#ff4f8b" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="wm-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb36b" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ff7a45" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="184" cy="12" r="9" fill="url(#wm-glow)" />
      <circle cx="184" cy="12" r="2.6" fill="#ffd9a8" />
      <text
        x="2"
        y="34"
        fill="url(#wm-fill)"
        fontSize="35"
        fontWeight="700"
        letterSpacing="-0.5"
        style={{ fontFamily: '"Snell Roundhand", "Apple Chancery", "Zapfino", "Savoye LET", cursive', fontStyle: "italic" }}
      >
        Songhearth
      </text>
      <path
        d="M4 44 C 38 38, 84 47, 128 42 S 178 40, 192 43"
        fill="none"
        stroke="url(#wm-swash)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10 47.5 C 50 43, 96 50, 140 46"
        fill="none"
        stroke="url(#wm-swash)"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}

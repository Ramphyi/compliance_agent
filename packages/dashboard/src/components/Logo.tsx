/**
 * The Acai mark: an açaí bowl seen from a slight 3/4 angle. Theme colours come from the
 * --lg-* variables in styles.css. With `animated`, hovering the logo (or the link around
 * it) makes the berries hop, the banana slices wobble, the spoon stir and the bowl settle.
 */
export function Logo({ size = 24, animated = false, className = "" }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <svg
      className={`logo${animated ? " logo--animated" : ""}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <g className="lg-all">
        <ellipse className="lg-inner" cx="32" cy="35" rx="27" ry="8.5" />
        <path className="lg-spoon" d="M44 25 L56.5 6.5" strokeWidth="3.6" strokeLinecap="round" />
        <path className="lg-acai" d="M5.8 35 C6.3 23.5 18.5 16.5 32 16.5 C45.5 16.5 57.7 23.5 58.2 35 A26.2 8.2 0 0 1 5.8 35 Z" />
        <g fill="#c58b46">
          <rect x="23.5" y="29.5" width="3.2" height="2.6" rx="0.9" transform="rotate(-18 25 31)" />
          <rect x="45.5" y="30.5" width="3.2" height="2.6" rx="0.9" transform="rotate(22 47 31.8)" />
          <rect x="51" y="26.5" width="2.8" height="2.4" rx="0.8" transform="rotate(-12 52.4 27.7)" />
          <rect x="31.5" y="31.5" width="2.6" height="2.2" rx="0.8" />
        </g>
        {[
          [13.5, 30],
          [20.5, 25.2],
          [28.5, 22.2],
        ].map(([cx, cy]) => (
          <g key={cx} className="lg-banana">
            <ellipse cx={cx} cy={cy} rx="4.6" ry="3.9" fill="#e7bf4f" />
            <ellipse cx={cx} cy={cy} rx="3.3" ry="2.7" fill="#fae7a8" />
          </g>
        ))}
        <g transform="translate(40.5 28.5)">
          <path d="M0 -4.6 C3.4 -5.2 5.6 -2.4 4.7 1 C3.9 3.8 1.4 5.6 0 6.2 C-1.4 5.6 -3.9 3.8 -4.7 1 C-5.6 -2.4 -3.4 -5.2 0 -4.6 Z" fill="#e0483f" />
          <path d="M0 -2.6 C2 -2.9 3.1 -1.3 2.6 0.7 C2.1 2.4 0.8 3.5 0 3.9 C-0.8 3.5 -2.1 2.4 -2.6 0.7 C-3.1 -1.3 -2 -2.9 0 -2.6 Z" fill="#f7a39b" />
          <path d="M-3 -4.6 L0 -3.2 L3 -4.6 L1.4 -6 L0 -4.8 L-1.4 -6 Z" fill="#3f9a5a" />
        </g>
        {[
          [36, 20.6],
          [42.2, 20.4],
          [48.4, 22.6],
        ].map(([cx, cy]) => (
          <g key={cx} className="lg-berry">
            <circle cx={cx} cy={cy} r="3" fill="#3a4bb0" />
            <circle cx={cx - 1} cy={cy - 1} r="1" fill="#a5aef0" />
          </g>
        ))}
        <g className="lg-mint">
          <path d="M31.5 17 C27.5 14.5 27 10.5 29 7.5 C32.5 9.5 33.5 13.5 31.5 17 Z" fill="#3f9a5a" />
          <path d="M31.5 17 C34 13.5 37.5 12.5 40.5 13.8 C38.8 17 35 18 31.5 17 Z" fill="#5bb174" />
        </g>
        <rect className="lg-bowl" x="22" y="55" width="20" height="5" rx="1.6" />
        <path className="lg-bowl" d="M5 35 C5 48.5 16.5 58 32 58 C47.5 58 59 48.5 59 35 A27 8.5 0 0 1 5 35 Z" />
        <path className="lg-lip" d="M5 35 A27 8.5 0 0 0 59 35" fill="none" strokeWidth="2" />
      </g>
    </svg>
  );
}

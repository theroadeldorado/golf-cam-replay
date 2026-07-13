/* ReplaySwing illustration set — schematic SVG scenes drawn in the desktop
   app's instrument-panel language (near-black bays, thin panel lines, amber /
   green / red state lamps, line-art golfer). Used as figures across the docs
   and the landing page. Pure SVG, no external assets, theme-matched. */

const C = {
  ink: '#0b0d0c',
  panel: '#14181a',
  raised: '#1a2020',
  line: '#232a28',
  lineB: '#2e3733',
  fg: '#e9ede9',
  muted: '#7f8a83',
  faint: '#566058',
  watch: '#d9a13c',
  lock: '#43b06c',
  lockB: '#5ec583',
  fire: '#d6483c',
} as const;

type FrameProps = { className?: string; label?: string };

/* ----------------------------------------------------------------------------
   Line-art golfer, drawn down-the-line, in a local 130 × 175 coordinate box.
   Callers place/scale it with a wrapping <g transform>. -------------------- */

function GolferAddress({ color = C.fg, width = 5 }: { color?: string; width?: number }) {
  return (
    <g fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="55" cy="28" r="11" />
      <path d="M58 39 L74 104" />
      <path d="M60 50 L84 92" />
      <path d="M84 92 L126 150" />
      <path d="M74 104 L63 141 L59 170" />
      <path d="M74 104 L90 141 L97 170" />
      <circle cx="126" cy="150" r="4.5" fill={color} stroke="none" />
    </g>
  );
}

function GolferSwing({ color = C.fg, width = 5 }: { color?: string; width?: number }) {
  return (
    <g fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="52" cy="30" r="11" />
      <path d="M55 41 L72 104" />
      <path d="M57 52 L93 44" />
      <path d="M93 44 L122 13" />
      <path d="M72 104 L60 141 L57 170" />
      <path d="M72 104 L88 141 L95 170" />
    </g>
  );
}

/* ---- Shared bits ------------------------------------------------------- */

function TallyBar({
  x,
  y,
  w,
  state,
}: {
  x: number;
  y: number;
  w: number;
  state: 'watching' | 'address' | 'capturing';
}) {
  const color = state === 'watching' ? C.watch : state === 'address' ? C.lock : C.fire;
  return <rect x={x} y={y} width={w} height="4" fill={color} />;
}

/* ============================================================================
   1. App window — the desktop UI, armed and watching. ---------------------- */

export function AppWindowIllustration({ className, label }: FrameProps) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 330" role="img" aria-label={label ?? 'The ReplaySwing app window, armed and watching for a swing'} className="w-full h-auto">
        <defs>
          <linearGradient id="aw-feed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#12201a" />
            <stop offset="0.6" stopColor="#0c1310" />
            <stop offset="1" stopColor="#070a08" />
          </linearGradient>
        </defs>

        {/* window shell */}
        <rect x="6" y="6" width="508" height="318" rx="12" fill={C.panel} stroke={C.line} />

        {/* topbar */}
        <text x="22" y="33" fontFamily="Archivo, sans-serif" fontSize="15" fontWeight="800" letterSpacing="1.2">
          <tspan fill={C.fg}>REPLAY</tspan>
          <tspan fill={C.lock}>SWING</tspan>
        </text>
        <rect x="378" y="18" width="56" height="22" rx="6" fill={C.watch} />
        <text x="406" y="33" textAnchor="middle" fontFamily="Archivo, sans-serif" fontSize="12" fontWeight="800" fill={C.ink} letterSpacing="1">
          ARM
        </text>
        <rect x="444" y="18" width="52" height="22" rx="6" fill={C.raised} stroke={C.line} />
        <text x="470" y="33" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill={C.muted}>
          PiP
        </text>
        <line x1="6" y1="50" x2="514" y2="50" stroke={C.line} />

        {/* tally strip — watching */}
        <TallyBar x={6} y={51} w={508} state="watching" />

        {/* camera tile */}
        <rect x="20" y="68" width="330" height="196" rx="8" fill="url(#aw-feed)" stroke={C.line} />
        <rect x="34" y="220" height="26" width="330" fill="none" />
        <g transform="translate(120 66) scale(1.05)">
          <GolferAddress color="#c9d3cd" width={5} />
        </g>
        {/* ground line */}
        <line x1="40" y1="245" x2="330" y2="245" stroke="#1c2a22" strokeWidth="2" />
        {/* cam tag */}
        <rect x="30" y="240" width="66" height="18" rx="4" fill="#0b0d0ccc" stroke={C.line} />
        <text x="63" y="253" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill={C.muted}>
          CAM · 1
        </text>

        {/* right rail — shots */}
        <line x1="360" y1="60" x2="360" y2="264" stroke={C.line} />
        <text x="374" y="76" fontFamily="IBM Plex Mono, monospace" fontSize="9" letterSpacing="1.5" fill={C.faint}>
          SESSION
        </text>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="374" y={84 + i * 58} width="120" height="42" rx="5" fill="#000" stroke={i === 0 ? C.lock : C.line} strokeWidth={i === 0 ? 1.5 : 1} />
            <g transform={`translate(${404 + 0} ${86 + i * 58}) scale(0.22)`}>
              <GolferSwing color="#4a5a52" width={9} />
            </g>
            <text x="380" y={120 + i * 58} fontFamily="IBM Plex Mono, monospace" fontSize="8" fill={C.faint}>
              {`SHOT ${String(3 - i).padStart(2, '0')}`}
            </text>
          </g>
        ))}

        {/* console bar */}
        <line x1="6" y1="276" x2="514" y2="276" stroke={C.line} />
        <text x="22" y="306" fontFamily="Archivo, sans-serif" fontSize="26" fontWeight="800" letterSpacing="2" fill={C.watch}>
          WATCHING
        </text>
        {/* meter */}
        <rect x="200" y="288" width="120" height="10" rx="5" fill={C.ink} stroke={C.line} />
        <rect x="202" y="290" width="46" height="6" rx="3" fill={C.watch} />
        <text x="496" y="300" textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill={C.muted}>
          03 SHOTS
        </text>
      </svg>
    </figure>
  );
}

/* ============================================================================
   2. Garage sim bay — a golfer mid-swing, camera + phone watching. --------- */

export function GarageSimIllustration({ className, label }: FrameProps) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 320" role="img" aria-label={label ?? 'A golfer mid-swing in a garage simulator bay, watched by a USB camera and a phone on a tripod'} className="w-full h-auto">
        <defs>
          <linearGradient id="gs-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1c3a4a" />
            <stop offset="0.55" stopColor="#20492f" />
            <stop offset="1" stopColor="#1a3a26" />
          </linearGradient>
          <linearGradient id="gs-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#14181a" />
            <stop offset="1" stopColor="#0b0d0c" />
          </linearGradient>
        </defs>

        {/* garage backdrop */}
        <rect x="0" y="0" width="520" height="320" fill={C.ink} />
        {/* garage door panel lines on the walls */}
        {[40, 74, 108].map((y) => (
          <line key={y} x1="14" y1={y} x2="120" y2={y} stroke="#171d1a" strokeWidth="2" />
        ))}
        {[40, 74, 108].map((y) => (
          <line key={`r${y}`} x1="400" y1={y} x2="506" y2={y} stroke="#171d1a" strokeWidth="2" />
        ))}

        {/* impact screen with projected fairway */}
        <rect x="126" y="26" width="268" height="168" rx="4" fill="url(#gs-sky)" stroke={C.lineB} strokeWidth="2" />
        {/* fairway */}
        <path d="M198 194 L322 194 L286 120 L234 120 Z" fill="#2f6b40" opacity="0.85" />
        <ellipse cx="260" cy="120" rx="30" ry="8" fill="#3c7d4d" opacity="0.7" />
        {/* launch-monitor readout on screen */}
        <text x="140" y="46" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill="#9fb3a6">
          265 yds · 112 mph
        </text>

        {/* floor */}
        <rect x="0" y="240" width="520" height="80" fill="url(#gs-floor)" />
        <line x1="0" y1="240" x2="520" y2="240" stroke="#1b2420" strokeWidth="2" />
        {/* hitting mat */}
        <ellipse cx="250" cy="272" rx="96" ry="18" fill="#14231a" stroke="#1f3527" />
        {/* ball on mat */}
        <circle cx="292" cy="270" r="4" fill="#e9ede9" />

        {/* golfer mid-swing on the mat */}
        <g transform="translate(196 128) scale(0.92)">
          <GolferSwing color={C.fg} width={5.5} />
        </g>

        {/* USB camera on tripod (down-the-line, right) */}
        <g stroke={C.lineB} strokeWidth="2.5" fill={C.raised} strokeLinecap="round">
          <rect x="430" y="150" width="34" height="22" rx="4" />
          <circle cx="447" cy="161" r="5.5" fill={C.ink} />
          <path d="M447 172 L447 250 M447 250 L430 286 M447 250 L464 286 M447 260 L455 286" fill="none" />
        </g>
        <circle cx="447" cy="161" r="2" fill={C.fire} stroke="none" />
        <text x="447" y="304" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9" fill={C.faint}>
          USB CAM
        </text>
        {/* sightline from camera to golfer */}
        <line x1="430" y1="161" x2="300" y2="200" stroke={C.lock} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />

        {/* phone on a small tripod (face-on, left) */}
        <g stroke={C.lineB} strokeWidth="2.5" fill={C.raised} strokeLinecap="round">
          <rect x="52" y="150" width="24" height="42" rx="5" />
          <path d="M64 192 L64 250 M64 250 L50 284 M64 250 L78 284" fill="none" />
        </g>
        <rect x="56" y="156" width="16" height="30" rx="2" fill={C.ink} />
        <circle cx="64" cy="150" r="2" fill={C.lock} stroke="none" />
        <text x="64" y="304" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9" fill={C.faint}>
          PHONE
        </text>
        <line x1="76" y1="168" x2="210" y2="205" stroke={C.lock} strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />
      </svg>
    </figure>
  );
}

/* ============================================================================
   3. Phone as camera — QR pairing → connected phone feed. ------------------ */

export function PhoneCameraIllustration({ className, label }: FrameProps) {
  // small deterministic QR-ish grid
  const cells = [
    0b1110111, 0b1010101, 0b1110100, 0b0001011, 0b1101110, 0b1010001, 0b1110111,
  ];
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 300" role="img" aria-label={label ?? 'Scanning the app QR code turns a phone into a wireless swing camera'} className="w-full h-auto">
        <rect x="0" y="0" width="520" height="300" rx="12" fill={C.panel} stroke={C.line} />

        {/* QR panel (from the desktop app) */}
        <text x="60" y="52" fontFamily="IBM Plex Mono, monospace" fontSize="10" letterSpacing="1.5" fill={C.muted}>
          ADD PHONE
        </text>
        <rect x="60" y="66" width="150" height="150" rx="10" fill="#f4f6f3" />
        <g fill={C.ink}>
          {cells.map((row, r) =>
            Array.from({ length: 7 }).map((_, c) =>
              row & (1 << (6 - c)) ? (
                <rect key={`${r}-${c}`} x={78 + c * 16} y={84 + r * 16} width="14" height="14" rx="2" />
              ) : null
            )
          )}
        </g>
        <text x="135" y="240" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill={C.muted}>
          replayswing.com/camera
        </text>

        {/* arrow */}
        <g stroke={C.lock} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M250 150 L300 150" />
          <path d="M290 142 L300 150 L290 158" />
        </g>

        {/* phone, connected & showing the golfer */}
        <rect x="336" y="44" width="132" height="212" rx="22" fill={C.ink} stroke={C.lineB} strokeWidth="2.5" />
        <rect x="348" y="64" width="108" height="172" rx="8" fill="#0c1310" />
        <g transform="translate(360 92) scale(0.62)">
          <GolferAddress color="#8fa79a" width={6} />
        </g>
        {/* connected pill */}
        <rect x="360" y="200" width="84" height="22" rx="11" fill="#132a1d" stroke={C.lock} />
        <circle cx="376" cy="211" r="3.5" fill={C.lock} />
        <text x="388" y="215" fontFamily="IBM Plex Mono, monospace" fontSize="9" fill={C.lockB}>
          LIVE
        </text>
        {/* speaker notch */}
        <rect x="388" y="52" width="28" height="4" rx="2" fill={C.line} />
      </svg>
    </figure>
  );
}

/* ============================================================================
   4. Tally states — WATCHING → SET → CAPTURE. ------------------------------ */

export function TallyStatesIllustration({ className, label }: FrameProps) {
  const states: { word: string; color: string; sub: string; state: 'watching' | 'address' | 'capturing' }[] = [
    { word: 'WATCHING', color: C.watch, sub: 'Armed — waiting for address', state: 'watching' },
    { word: 'SET', color: C.lock, sub: 'Still at address — trigger live', state: 'address' },
    { word: 'CAPTURE', color: C.fire, sub: 'Swing detected — saving clip', state: 'capturing' },
  ];
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 180" role="img" aria-label={label ?? 'The tally strip shows three states: watching (amber), set (green), capture (red)'} className="w-full h-auto">
        {states.map((s, i) => {
          const x = 8 + i * 172;
          return (
            <g key={s.word}>
              <rect x={x} y="16" width="156" height="148" rx="10" fill={C.panel} stroke={C.line} />
              <TallyBar x={x} y={17} w={156} state={s.state} />
              <text x={x + 16} y="90" fontFamily="Archivo, sans-serif" fontSize={s.word.length > 6 ? 22 : 26} fontWeight="800" letterSpacing="1.5" fill={s.color}>
                {s.word}
              </text>
              <circle cx={x + 24} cy="116" r="6" fill={s.color} />
              <text x={x + 16} y="146" fontFamily="IBM Plex Mono, monospace" fontSize="9.5" fill={C.muted}>
                <tspan x={x + 16} dy="0">{s.sub.split(' — ')[0]}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/* ============================================================================
   5. PiP overlay — replay floating over the sim screen. -------------------- */

export function PipOverlayIllustration({ className, label }: FrameProps) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 320" role="img" aria-label={label ?? 'The Picture-in-Picture replay window floating on top of the fullscreen simulator'} className="w-full h-auto">
        <defs>
          <linearGradient id="pip-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1c3a4a" />
            <stop offset="0.6" stopColor="#20492f" />
            <stop offset="1" stopColor="#15301f" />
          </linearGradient>
        </defs>

        {/* fullscreen sim */}
        <rect x="8" y="8" width="504" height="304" rx="10" fill="url(#pip-sky)" stroke={C.lineB} />
        <path d="M150 312 L370 312 L306 150 L214 150 Z" fill="#2f6b40" opacity="0.7" />
        <text x="30" y="40" fontFamily="IBM Plex Mono, monospace" fontSize="12" fill="#a9bcb0">
          SIMULATOR · CARRY 265 · BALL 112
        </text>

        {/* PiP window, ringed in green */}
        <g>
          <rect x="316" y="188" width="176" height="112" rx="10" fill={C.ink} stroke={C.lock} strokeWidth="2" />
          <rect x="316" y="188" width="176" height="112" rx="10" fill="none" stroke={C.lock} strokeOpacity="0.25" strokeWidth="6" />
          <g transform="translate(348 196) scale(0.5)">
            <GolferSwing color={C.lockB} width={7} />
          </g>
          {/* replay progress */}
          <rect x="326" y="286" width="156" height="3" rx="1.5" fill="#1c2a22" />
          <rect x="326" y="286" width="92" height="3" rx="1.5" fill={C.lock} />
          <text x="326" y="280" fontFamily="IBM Plex Mono, monospace" fontSize="9" fill={C.muted}>
            REPLAY
          </text>
          <text x="482" y="280" textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="9" fill={C.lockB}>
            0.5×
          </text>
        </g>
      </svg>
    </figure>
  );
}

/* ============================================================================
   6. Drawing tools — swing-plane line + alignment circle on a clip. -------- */

export function DrawingToolsIllustration({ className, label }: FrameProps) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 300" role="img" aria-label={label ?? 'A swing-plane line and alignment circle drawn on a swing clip'} className="w-full h-auto">
        <defs>
          <linearGradient id="dt-feed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#12201a" />
            <stop offset="1" stopColor="#070a08" />
          </linearGradient>
        </defs>
        <rect x="8" y="8" width="504" height="284" rx="10" fill="url(#dt-feed)" stroke={C.line} />

        {/* draw toolbar */}
        <rect x="24" y="24" width="150" height="34" rx="8" fill="#0b0d0cd9" stroke={C.line} />
        {['✎', '／', '○'].map((g, i) => (
          <g key={i}>
            <rect x={30 + i * 34} y="29" width="24" height="24" rx="6" fill={i === 1 ? C.lock : 'transparent'} stroke={i === 1 ? C.lock : C.line} />
            <text x={42 + i * 34} y="46" textAnchor="middle" fontFamily="sans-serif" fontSize="13" fill={i === 1 ? C.ink : C.muted}>
              {g}
            </text>
          </g>
        ))}
        {[C.fire, C.watch, C.lock].map((col, i) => (
          <circle key={col} cx={140 + i * 10} cy="41" r="4.5" fill={col} stroke={i === 2 ? C.fg : 'none'} />
        ))}

        {/* golfer */}
        <g transform="translate(180 76) scale(1.02)">
          <GolferAddress color="#b7c3bc" width={5} />
        </g>

        {/* swing-plane line */}
        <line x1="300" y1="240" x2="220" y2="110" stroke={C.watch} strokeWidth="2.5" strokeLinecap="round" />
        {/* alignment circle on the ball */}
        <circle cx="300" cy="243" r="20" fill="none" stroke={C.fire} strokeWidth="2.5" />

        <text x="30" y="278" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill={C.muted}>
          CAM · 1 — drawings saved per camera
        </text>
      </svg>
    </figure>
  );
}

/* ============================================================================
   7. Compare swings — two clips on one synced timeline. -------------------- */

export function CompareSwingsIllustration({ className, label }: FrameProps) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 300" role="img" aria-label={label ?? 'Two swings side by side on one synchronized timeline'} className="w-full h-auto">
        <rect x="8" y="8" width="504" height="284" rx="10" fill={C.panel} stroke={C.line} />

        {[
          { x: 24, badge: 'A', tint: '#b7c3bc', title: 'TODAY · SHOT 12' },
          { x: 268, badge: 'B', tint: '#8fa79a', title: 'LAST WK · SHOT 04' },
        ].map((p) => (
          <g key={p.badge}>
            <rect x={p.x} y="24" width="20" height="20" rx="5" fill={C.lock} />
            <text x={p.x + 10} y="39" textAnchor="middle" fontFamily="Archivo, sans-serif" fontSize="12" fontWeight="800" fill={C.ink}>
              {p.badge}
            </text>
            <text x={p.x + 30} y="39" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill={C.muted}>
              {p.title}
            </text>
            <rect x={p.x} y="54" width="224" height="150" rx="8" fill="#0a0f0c" stroke={C.line} />
            <g transform={`translate(${p.x + 62} 64) scale(0.82)`}>
              <GolferSwing color={p.tint} width={5.5} />
            </g>
          </g>
        ))}

        {/* shared timeline */}
        <rect x="24" y="228" width="468" height="6" rx="3" fill={C.ink} stroke={C.line} />
        <rect x="24" y="228" width="250" height="6" rx="3" fill={C.lock} />
        <circle cx="274" cy="231" r="8" fill={C.lockB} stroke={C.ink} strokeWidth="2" />
        {/* controls */}
        <text x="24" y="266" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill={C.muted}>
          ◁ ▷  ·  0.25×  ·  OFFSET −2f / +2f
        </text>
        <text x="492" y="266" textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill={C.faint}>
          IMPACT ALIGNED
        </text>
      </svg>
    </figure>
  );
}

/* ============================================================================
   8. Auto-arm — a person steps into frame and the system arms. ------------- */

export function AutoArmIllustration({ className, label }: FrameProps) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 220" role="img" aria-label={label ?? 'Auto-arm: stepping into the camera view arms the system automatically'} className="w-full h-auto">
        <defs>
          <linearGradient id="aa-feed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#12201a" />
            <stop offset="1" stopColor="#070a08" />
          </linearGradient>
        </defs>

        {/* empty frame — disarmed */}
        <rect x="16" y="24" width="228" height="172" rx="10" fill="url(#aa-feed)" stroke={C.line} />
        <TallyBar x={16} y={25} w={228} state="watching" />
        <rect x="16" y="25" width="228" height="4" fill={C.faint} />
        <text x="130" y="120" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="11" fill={C.faint}>
          NO ONE IN FRAME
        </text>
        <text x="30" y="184" fontFamily="Archivo, sans-serif" fontSize="15" fontWeight="800" letterSpacing="1" fill={C.faint}>
          DISARMED
        </text>

        {/* arrow */}
        <g stroke={C.lock} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M258 110 L282 110" />
          <path d="M274 103 L282 110 L274 117" />
        </g>

        {/* occupied frame — armed */}
        <rect x="296" y="24" width="228" height="172" rx="10" fill="url(#aa-feed)" stroke={C.watch} strokeOpacity="0.5" />
        <TallyBar x={296} y={25} w={228} state="watching" />
        <g transform="translate(360 44) scale(0.86)">
          <GolferAddress color="#c9d3cd" width={5} />
        </g>
        {/* pose detection box */}
        <rect x="360" y="42" width="96" height="140" rx="4" fill="none" stroke={C.lock} strokeWidth="1.5" strokeDasharray="5 5" />
        <text x="310" y="184" fontFamily="Archivo, sans-serif" fontSize="15" fontWeight="800" letterSpacing="1" fill={C.watch}>
          WATCHING
        </text>
      </svg>
    </figure>
  );
}

/* ============================================================================
   9. Session rail — captured shots with thumbnails. ----------------------- */

export function SessionsIllustration({ className, label }: FrameProps) {
  return (
    <figure className={className}>
      <svg viewBox="0 0 520 250" role="img" aria-label={label ?? 'The session shot rail with thumbnails, pin, and delete controls'} className="w-full h-auto">
        <rect x="8" y="8" width="504" height="234" rx="10" fill={C.panel} stroke={C.line} />
        <text x="26" y="36" fontFamily="IBM Plex Mono, monospace" fontSize="10" letterSpacing="1.5" fill={C.muted}>
          SESSION · JUL 12 · 3:14 PM
        </text>
        <line x1="26" y1="48" x2="494" y2="48" stroke={C.line} />

        {[0, 1, 2, 3].map((i) => {
          const x = 26 + i * 120;
          const active = i === 0;
          const pinned = i === 1;
          return (
            <g key={i}>
              <rect x={x} y="66" width="104" height="118" rx="8" fill="#000" stroke={active ? C.lock : C.line} strokeWidth={active ? 2 : 1} />
              <g transform={`translate(${x + 22} 72) scale(0.44)`}>
                <GolferSwing color="#5b6d64" width={8} />
              </g>
              <rect x={x} y="150" width="104" height="34" rx="0" fill="#1a2020" />
              <text x={x + 10} y="171" fontFamily="IBM Plex Mono, monospace" fontSize="9" fill={C.muted}>
                {`SHOT ${String(i + 1).padStart(2, '0')}`}
              </text>
              <text x={x + 94} y="171" textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize="9" fill={C.faint}>
                {`3:1${i}`}
              </text>
              {/* pin */}
              <text x={x + 90} y="84" textAnchor="middle" fontFamily="sans-serif" fontSize="13" fill={pinned ? C.watch : C.faint}>
                ★
              </text>
            </g>
          );
        })}
        <text x="26" y="214" fontFamily="IBM Plex Mono, monospace" fontSize="10" fill={C.faint}>
          ★ pin your best · ✕ delete mishits · click any shot to replay
        </text>
      </svg>
    </figure>
  );
}

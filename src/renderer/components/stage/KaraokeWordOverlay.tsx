import {
  activeLineAt,
  wordHighlightState,
  type TimedKaraokeScript
} from '../../../shared/timedKaraoke';

/**
 * Stage word-level karaoke overlay (STT). Edge-safe bottom band; no cards.
 * When syllables exist (BPE pieces), fills a tempo inside the current word.
 */
export function KaraokeWordOverlay({
  script,
  currentTimeSec,
  syncOffsetMs
}: {
  script: TimedKaraokeScript;
  currentTimeSec: number;
  syncOffsetMs: number;
}) {
  const tMs = currentTimeSec * 1000 + (Number.isFinite(syncOffsetMs) ? syncOffsetMs : 0);
  const line = activeLineAt(script, tMs);
  if (!line) return null;
  const words = wordHighlightState(line, tMs);

  return (
    <div
      className="absolute inset-x-0 bottom-[12%] px-6 pointer-events-none z-20"
      data-testid="karaoke-word-overlay"
      aria-hidden
    >
      <p className="text-center text-3xl md:text-5xl lg:text-6xl font-black tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] leading-snug">
        {words.map((w, i) => {
          // Syllable-aware fill for the current word when Phase A pieces exist.
          if (w.state === 'current' && w.syllables && w.syllables.length > 1) {
            return (
              <span key={`${i}-${w.text}`}>
                {w.syllables.map((s, si) => (
                  <span
                    key={`${i}-${si}-${s.text}`}
                    className={
                      s.state === 'past'
                        ? 'text-amber-300'
                        : s.state === 'current'
                          ? 'text-pink-400'
                          : 'text-white/65'
                    }
                    style={
                      s.state === 'current'
                        ? {
                            backgroundImage: `linear-gradient(90deg, #fbbf24 ${s.progress * 100}%, rgba(255,255,255,0.65) ${s.progress * 100}%)`,
                            WebkitBackgroundClip: 'text',
                            backgroundClip: 'text',
                            color: 'transparent'
                          }
                        : undefined
                    }
                  >
                    {s.text}
                  </span>
                ))}
                {i < words.length - 1 ? ' ' : ''}
              </span>
            );
          }
          return (
            <span
              key={`${i}-${w.text}`}
              className={
                w.state === 'past'
                  ? 'text-amber-300'
                  : w.state === 'current'
                    ? 'text-pink-400'
                    : 'text-white/65'
              }
              style={
                w.state === 'current'
                  ? {
                      backgroundImage: `linear-gradient(90deg, #fbbf24 ${w.progress * 100}%, rgba(255,255,255,0.65) ${w.progress * 100}%)`,
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent'
                    }
                  : undefined
              }
            >
              {w.text}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </p>
    </div>
  );
}

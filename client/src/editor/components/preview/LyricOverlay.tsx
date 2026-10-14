import { sampleEnvelope } from '../../lib/audio-features';
import { findActiveLineIndex, isEmphasized } from '../../lib/lyrics';
import { songTimeAt, useLyricsStore } from '../../stores/lyrics-store';
import { usePlaybackStore } from '../../stores/playback-store';

const METER_BARS = 12;

/**
 * Live lyric visualizer drawn over the preview canvas. Preview-only: use
 * "Add lyrics to timeline" in the Lyrics panel to get lyrics into the export.
 * `scale` is preview pixels per canvas pixel, so sizes match the canvas.
 */
export function LyricOverlay({ scale }: { scale: number }) {
    const { analysis, features, style, visible, source } = useLyricsStore();
    const currentTime = usePlaybackStore((s) => s.currentTime);

    if (!analysis || !visible) return null;
    const songTime = songTimeAt(source, currentTime);
    if (songTime === null) return null;

    const index = findActiveLineIndex(analysis.lines, songTime);
    const line = index >= 0 ? analysis.lines[index] : null;
    const next = analysis.lines[index + 1] ?? null;
    const energy = sampleEnvelope(features, songTime);
    const pulse = 1 + energy * 0.08;
    const px = (canvasPx: number) => canvasPx * scale;

    return (
        <div className="ke-lyrics" aria-hidden>
            <div className="ke-lyrics__glow" style={{ opacity: 0.2 + energy * 0.6 }} />

            {line ? (
                <span className="ke-lyrics__section" style={{ fontSize: px(22), top: px(40), left: px(40) }}>
                    {line.section}
                </span>
            ) : null}

            {features ? (
                <div className="ke-lyrics__meter" style={{ top: px(40), right: px(40), height: px(56), gap: px(5) }}>
                    {Array.from({ length: METER_BARS }, (_, i) => {
                        const level = sampleEnvelope(features, songTime - Math.abs(i - (METER_BARS - 1) / 2) * 0.04);
                        return <span key={i} style={{ width: px(7), height: `${Math.max(8, level * 100)}%`, opacity: 0.35 + level * 0.65 }} />;
                    })}
                </div>
            ) : null}

            {line && style === 'karaoke' ? (
                <div className="ke-lyrics__karaoke" style={{ bottom: px(300), padding: `0 ${px(60)}px` }}>
                    <p style={{ fontSize: px(64) }}>
                        {line.words.map((word, i) => {
                            const sung = word.start <= songTime;
                            const current = sung && songTime < word.end;
                            const classes = ['ke-lyrics__word', sung ? 'is-sung' : '', current ? 'is-current' : '', sung && isEmphasized(line, word.text) ? 'is-emphasis' : ''];
                            return (
                                <span key={`${line.id}-${i}`} className={classes.join(' ')}>
                                    {word.text}{' '}
                                </span>
                            );
                        })}
                    </p>
                    {next ? (
                        <p className="ke-lyrics__next" style={{ fontSize: px(36) }}>
                            {next.text}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {line && style === 'kinetic'
                ? (() => {
                      const sungWords = line.words.filter((w) => w.start <= songTime);
                      const word = sungWords[sungWords.length - 1] ?? line.words[0] ?? { text: line.text };
                      const emphasized = isEmphasized(line, word.text);
                      return (
                          <div className="ke-lyrics__kinetic" style={{ padding: `0 ${px(60)}px` }}>
                              <p
                                  key={`${line.id}-${word.text}`}
                                  className={`ke-lyrics__big ${emphasized ? 'is-emphasis' : ''}`}
                                  style={{ fontSize: px(150), transform: `scale(${pulse * (emphasized ? 1.15 : 1)})` }}
                              >
                                  {word.text}
                              </p>
                              <p className="ke-lyrics__line" style={{ fontSize: px(30), marginTop: px(40) }}>
                                  {line.text}
                              </p>
                          </div>
                      );
                  })()
                : null}

            {line && style === 'spotlight' ? (
                <div className="ke-lyrics__spotlight" style={{ padding: `0 ${px(80)}px` }}>
                    <p key={line.id} style={{ fontSize: px(58), transform: `scale(${pulse})` }}>
                        {line.words.map((word, i) => (
                            <span key={`${line.id}-${i}`} className={isEmphasized(line, word.text) ? 'is-emphasis' : ''}>
                                {word.text}{' '}
                            </span>
                        ))}
                    </p>
                </div>
            ) : null}
        </div>
    );
}

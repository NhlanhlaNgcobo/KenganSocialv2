import { memo, useMemo } from 'react';
import { formatShort } from '../../lib/time';

interface Props {
    pixelsPerSecond: number;
    visibleSeconds: number;
}

/** Picks a label interval that keeps labels roughly 80px apart. */
function pickInterval(pps: number) {
    const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    return candidates.find((c) => c * pps >= 80) ?? 600;
}

export const TimelineRuler = memo(function TimelineRuler({ pixelsPerSecond, visibleSeconds }: Props) {
    const { marks, subSecond } = useMemo(() => {
        const interval = pickInterval(pixelsPerSecond);
        const minor = interval / 5;
        const list: { t: number; major: boolean }[] = [];
        for (let i = 0; i * minor <= visibleSeconds; i += 1) {
            list.push({ t: i * minor, major: i % 5 === 0 });
        }
        return { marks: list, subSecond: interval < 1 };
    }, [pixelsPerSecond, visibleSeconds]);

    return (
        <div className="ke-ruler" style={{ width: visibleSeconds * pixelsPerSecond }}>
            {marks.map(({ t, major }) => (
                <div key={t} className={`ke-ruler__tick ${major ? 'is-major' : ''}`} style={{ left: t * pixelsPerSecond }}>
                    {major ? <span>{subSecond ? `${t.toFixed(2)}s` : formatShort(t)}</span> : null}
                </div>
            ))}
        </div>
    );
});

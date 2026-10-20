import { useEffect, useMemo, useRef, useState } from 'react';
import { buildLut, sampleLut, vignetteAt } from '../../lib/color-pipeline.js';
import { scopePoints, type ScopeMode } from '../../lib/color-scopes';
import { useMediaStore } from '../../stores/media-store';
import { usePlaybackStore } from '../../stores/playback-store';
import { useProjectStore } from '../../stores/project-store';
import type { ColorSettings, MediaElement } from '../../types';

/** Independently seeks a tiny source frame; never changes the editor's playback element. */
export function ColorScopes({ el, color }: { el: MediaElement; color: ColorSettings }) {
    const media = useMediaStore((s) => s.items.find((m) => m.id === el.mediaId));
    const luts = useProjectStore((s) => s.luts);
    const sampleTime = usePlaybackStore((s) => Math.round(Math.max(el.trimStart, Math.min(el.duration - el.trimEnd - 0.04,
        el.trimStart + (s.currentTime - el.startTime) * (el.speed || 1))) * 5) / 5);
    const [mode, setMode] = useState<ScopeMode>('waveform');
    const [original, setOriginal] = useState(false);
    const [status, setStatus] = useState('Loading frame…');
    const [pixels, setPixels] = useState<ImageData | null>(null);
    const frameRef = useRef<HTMLCanvasElement>(null);
    const scopeRef = useRef<HTMLCanvasElement>(null);
    const sourceRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
    const lut = useMemo(() => buildLut(color, luts), [JSON.stringify(color), luts]);
    useEffect(() => {
        if (!media) return;
        let disposed = false;
        const source = media.type === 'image' ? new Image() : document.createElement('video');
        sourceRef.current = source;
        source.crossOrigin = 'anonymous';
        const capture = () => {
            if (disposed) return;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 160; canvas.height = 90;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(source, 0, 0, 160, 90);
                setPixels(ctx.getImageData(0, 0, 160, 90));
            } catch { setStatus('This source cannot be sampled.'); }
        };
        if (source instanceof HTMLVideoElement) {
            source.muted = true; source.preload = 'auto';
            source.onloadeddata = () => { source.currentTime = Math.min(sampleTime, Math.max(0, source.duration - 0.04)); capture(); };
            source.onseeked = capture;
        } else source.onload = capture;
        source.onerror = () => setStatus('Unable to load scope frame.');
        source.src = media.url;
        return () => { disposed = true; sourceRef.current = null; source.onload = null; source.onerror = null;
            if (source instanceof HTMLVideoElement) { source.onloadeddata = null; source.onseeked = null; source.removeAttribute('src'); source.load(); } };
    }, [media?.url]);
    useEffect(() => {
        const source = sourceRef.current;
        if (source instanceof HTMLVideoElement && source.readyState >= 2 && !source.seeking) source.currentTime = Math.min(sampleTime, Math.max(0, source.duration - 0.04));
    }, [sampleTime]);
    useEffect(() => {
        if (!pixels || !frameRef.current || !scopeRef.current) return;
        const data = new Uint8ClampedArray(pixels.data);
        if (!original) for (let i = 0; i < data.length; i += 4) {
            const rgb = sampleLut(lut, data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
            const v = vignetteAt(color.vignette, ((i / 4) % 160 + 0.5) / 160, (Math.floor(i / 4 / 160) + 0.5) / 90, (media?.width || 16) / (media?.height || 9));
            for (let c = 0; c < 3; c++) data[i + c] = Math.round(Math.max(0, Math.min(1, rgb[c] * v.dark + (1 - rgb[c]) * v.light)) * 255);
        }
        frameRef.current.getContext('2d')!.putImageData(new ImageData(data, 160, 90), 0, 0);
        const result = scopePoints(data, 160, mode);
        const ctx = scopeRef.current.getContext('2d')!;
        ctx.fillStyle = '#090b10'; ctx.fillRect(0, 0, 300, 160);
        ctx.strokeStyle = '#303541'; ctx.lineWidth = 1;
        for (let y = 0; y <= 160; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(300, y); ctx.stroke(); }
        if (mode === 'vectorscope') { ctx.beginPath(); ctx.ellipse(150, 80, 75, 40, 0, 0, Math.PI * 2); ctx.stroke(); }
        result.points.forEach((p) => { ctx.fillStyle = ['#ff646499', '#6aff9299', '#6498ff99', '#d5f4c64d'][p.channel];
            if (mode === 'histogram') ctx.fillRect(p.x * 299, p.y * 159, 1, 160 - p.y * 159);
            else ctx.fillRect(p.x * 299, p.y * 159, 1, 1); });
        setStatus(`Near black: ${result.black.toFixed(1)}% · near white: ${result.white.toFixed(1)}% (any RGB channel)`);
    }, [pixels, lut, original, mode, color.vignette]);
    return <div className="ke-scopes">
        <select className="ke-select" aria-label="Colour scope" value={mode} onChange={(e) => setMode(e.target.value as ScopeMode)}>
            <option value="waveform">Luma waveform · 0–100%</option><option value="parade">RGB parade · 0–100%</option><option value="vectorscope">Vectorscope · Rec.709 coefficients</option><option value="histogram">RGB histogram</option>
        </select>
        <canvas ref={scopeRef} width={300} height={160} aria-label={mode} />
        <canvas ref={frameRef} width={160} height={90} style={{ aspectRatio: `${media?.width || 16}/${media?.height || 9}` }} aria-label="Sampled colour frame" />
        <button className={`ke-btn ke-btn--sm ${original ? 'is-active' : ''}`} aria-pressed={original} onClick={() => setOriginal(!original)}>{original ? 'Original sample' : 'Graded sample'} · compare</button>
        <p className="ke-note">{status}</p>
        <p className="ke-note">Selected source frame, SDR full range, sampled at 5 fps. Grade and vignette included; framing, overlays and timeline effects excluded. These are not final-output or HDR scopes.</p>
    </div>;
}

/**
 * Colour-graded preview: draws a video (or image) through the clip's 3D LUT on the GPU (WebGL2).
 * The LUT comes from lib/color-pipeline.js, the same code the export renderer uses for lut3d,
 * so the preview matches the export.
 */
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { buildLut } from '../../lib/color-pipeline.js';
import type { ColorSettings } from '../../types';

// Preview LUT resolution: 25³ rebuilds fast enough while dragging sliders; trilinear sampling
// makes the difference from the export's 33³ invisible.
const PREVIEW_LUT_SIZE = 25;

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_frame;
uniform sampler3D u_lut;
uniform float u_size;
in vec2 v_uv;
out vec4 outColor;
void main() {
    vec3 c = texture(u_frame, v_uv).rgb;
    vec3 coord = c * ((u_size - 1.0) / u_size) + 0.5 / u_size;
    outColor = vec4(texture(u_lut, coord).rgb, 1.0);
}`;

/** LUTs cached by settings, shared by all clips with the same grade. */
const lutCache = new Map<string, Float32Array>();

export function useLut(color: ColorSettings | null | undefined, luts: Record<string, { size: number; data: number[] }>) {
    return useMemo(() => {
        if (!color) return null;
        const look = color.creative?.look;
        const usedLut = look?.startsWith('lut:') ? luts[look.slice(4)] : null;
        const key = JSON.stringify(color) + (usedLut ? `#${look}:${usedLut.size}` : '');
        let data = lutCache.get(key);
        if (!data) {
            const imported = usedLut ? { [look!.slice(4)]: { size: usedLut.size, data: Float32Array.from(usedLut.data) } } : {};
            data = buildLut(color, imported, PREVIEW_LUT_SIZE).data;
            if (lutCache.size > 40) lutCache.delete(lutCache.keys().next().value as string);
            lutCache.set(key, data);
        }
        return data;
    }, [color, luts]);
}

interface Props {
    source: HTMLVideoElement | HTMLImageElement | null;
    lut: Float32Array;
    style?: CSSProperties;
    className?: string;
}

export function GradedCanvas({ source, lut, style, className }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<{ gl: WebGL2RenderingContext; frame: WebGLTexture; lutTex: WebGLTexture } | null>(null);
    const drawRef = useRef<() => void>(() => {});

    // Set up WebGL once.
    useEffect(() => {
        const canvas = canvasRef.current;
        const gl = canvas?.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false });
        if (!canvas || !gl) return undefined;
        const compile = (type: number, src: string) => {
            const sh = gl.createShader(type)!;
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            return sh;
        };
        const prog = gl.createProgram()!;
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(prog);
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const frame = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, frame);
        for (const [k, v] of [
            [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
            [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
        ])
            gl.texParameteri(gl.TEXTURE_2D, k, v);
        const lutTex = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, lutTex);
        for (const [k, v] of [
            [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
            [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE],
        ])
            gl.texParameteri(gl.TEXTURE_3D, k, v);
        gl.uniform1i(gl.getUniformLocation(prog, 'u_frame'), 0);
        gl.uniform1i(gl.getUniformLocation(prog, 'u_lut'), 1);
        gl.uniform1f(gl.getUniformLocation(prog, 'u_size'), PREVIEW_LUT_SIZE);
        glRef.current = { gl, frame, lutTex };
        return () => {
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            glRef.current = null;
        };
    }, []);

    // Upload the LUT when the grade changes.
    useEffect(() => {
        const ctx = glRef.current;
        if (!ctx) return;
        const { gl, lutTex } = ctx;
        const rgba = new Float32Array((lut.length / 3) * 4);
        for (let i = 0, j = 0; i < lut.length; i += 3, j += 4) {
            rgba[j] = lut[i];
            rgba[j + 1] = lut[i + 1];
            rgba[j + 2] = lut[i + 2];
            rgba[j + 3] = 1;
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, lutTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, PREVIEW_LUT_SIZE, PREVIEW_LUT_SIZE, PREVIEW_LUT_SIZE, 0, gl.RGBA, gl.FLOAT, rgba);
        drawRef.current();
    }, [lut]);

    // Draw frames: on every decoded video frame, on seeks and when the grade changes.
    useEffect(() => {
        const ctx = glRef.current;
        const canvas = canvasRef.current;
        if (!ctx || !canvas || !source) return undefined;
        const { gl, frame } = ctx;
        const draw = () => {
            const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
            const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
            if (!w || !h) return;
            // Cap the drawing size: the preview is small and this keeps playback smooth.
            const scale = Math.min(1, 1280 / Math.max(w, h));
            const cw = Math.round(w * scale);
            const ch = Math.round(h * scale);
            if (canvas.width !== cw || canvas.height !== ch) {
                canvas.width = cw;
                canvas.height = ch;
            }
            gl.viewport(0, 0, cw, ch);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, frame);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            } catch {
                return; // not ready yet
            }
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        drawRef.current = draw;
        let raf = 0;
        let videoCb = 0;
        let stopped = false;
        if (source instanceof HTMLVideoElement) {
            const v = source as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (id: number) => void };
            if (v.requestVideoFrameCallback) {
                const onFrame = () => {
                    if (stopped) return;
                    draw();
                    videoCb = v.requestVideoFrameCallback!(onFrame);
                };
                videoCb = v.requestVideoFrameCallback(onFrame);
            } else {
                const loop = () => {
                    if (stopped) return;
                    draw();
                    raf = requestAnimationFrame(loop);
                };
                raf = requestAnimationFrame(loop);
            }
            const onEvent = () => draw();
            v.addEventListener('seeked', onEvent);
            v.addEventListener('loadeddata', onEvent);
            draw();
            return () => {
                stopped = true;
                cancelAnimationFrame(raf);
                if (videoCb && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(videoCb);
                v.removeEventListener('seeked', onEvent);
                v.removeEventListener('loadeddata', onEvent);
            };
        }
        const img = source as HTMLImageElement;
        if (img.complete) draw();
        img.addEventListener('load', draw);
        return () => img.removeEventListener('load', draw);
    }, [source]);

    return <canvas ref={canvasRef} className={className} style={style} />;
}

/** True when WebGL2 is available (otherwise the preview falls back to CSS approximations). */
export const webgl2Available = (() => {
    try {
        const gl = document.createElement('canvas').getContext('webgl2');
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        return !!gl;
    } catch {
        return false;
    }
})();

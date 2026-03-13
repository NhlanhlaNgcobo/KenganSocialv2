import { useState } from 'react';
import {
    Video, Music, Gauge, Wand2, Sun, Sparkles,
    RotateCw, Move, Maximize2, AlignCenter, Type, Plus, Trash2
} from 'lucide-react';

const TABS = [
    { id: 'video', label: 'Video', icon: Video },
    { id: 'audio', label: 'Audio', icon: Music },
    { id: 'speed', label: 'Speed', icon: Gauge },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'adjust', label: 'Adjust', icon: Sun },
    { id: 'ai', label: 'AI stylize', icon: Sparkles },
];

const SUB_TABS = ['Basic', 'Remove BG', 'Mask', 'Retouch'];

const SPEED_PRESETS = [0.1, 0.2, 0.5, 1, 1.5, 2, 5, 10, 100];

const FILTERS = [
    { id: 'none', name: 'None' }, { id: 'vivid', name: 'Vivid' },
    { id: 'fade', name: 'Fade' }, { id: 'noir', name: 'Noir' },
    { id: 'warm', name: 'Warm' }, { id: 'cool', name: 'Cool' },
    { id: 'drama', name: 'Drama' }, { id: 'neon', name: 'Neon' },
    { id: 'retro', name: 'Retro' }, { id: 'cinema', name: 'Cinema' },
];

const TRANSITIONS = [
    { id: 'none', name: 'None' },
    { id: 'fade', name: 'Fade' },
    { id: 'slide', name: 'Slide' },
    { id: 'wipe', name: 'Wipe' },
    { id: 'zoom', name: 'Zoom' },
    { id: 'dissolve', name: 'Dissolve' },
];

export default function PropertiesPanel({ activeClip, onUpdateClip, onSaveHistory }) {
    const [activeTab, setActiveTab] = useState('video');
    const [activeSubTab, setActiveSubTab] = useState('Basic');
    const [newOverlayText, setNewOverlayText] = useState('');

    if (!activeClip) {
        return (
            <div className="cc-properties">
                <div className="cc-props-empty">
                    <p>Select a clip on the timeline to edit its properties</p>
                </div>
            </div>
        );
    }

    const update = (key, value) => onUpdateClip(activeClip.id, key, value);
    const updateTransform = (key, value) => {
        const t = { ...(activeClip.transform || { scale: 100, x: 0, y: 0, rotate: 0 }), [key]: value };
        update('transform', t);
    };

    const handleSliderRelease = () => {
        if (onSaveHistory) onSaveHistory();
    };

    // Alignment handler
    const handleAlign = (position) => {
        const alignMap = {
            '↖': { x: -100, y: -100 },
            '↑': { x: 0, y: -100 },
            '↗': { x: 100, y: -100 },
            '←': { x: -100, y: 0 },
            '·': { x: 0, y: 0 },
            '→': { x: 100, y: 0 },
            '↙': { x: -100, y: 100 },
            '↓': { x: 0, y: 100 },
            '↘': { x: 100, y: 100 },
        };
        const pos = alignMap[position];
        if (pos) {
            updateTransform('x', pos.x);
            updateTransform('y', pos.y);
            if (onSaveHistory) onSaveHistory();
        }
    };

    // Add text overlay
    const addTextOverlay = () => {
        const text = newOverlayText.trim() || 'Text';
        const overlays = [...(activeClip.textOverlays || []), {
            text,
            x: 50,
            y: 80,
            size: 32,
            color: '#ffffff',
            start: 0,
            end: activeClip.duration || 3,
        }];
        update('textOverlays', overlays);
        setNewOverlayText('');
        if (onSaveHistory) onSaveHistory();
    };

    // Remove text overlay
    const removeTextOverlay = (index) => {
        const overlays = [...(activeClip.textOverlays || [])];
        overlays.splice(index, 1);
        update('textOverlays', overlays);
        if (onSaveHistory) onSaveHistory();
    };

    // Update individual text overlay
    const updateTextOverlay = (index, key, value) => {
        const overlays = [...(activeClip.textOverlays || [])];
        overlays[index] = { ...overlays[index], [key]: value };
        update('textOverlays', overlays);
    };

    return (
        <div className="cc-properties">
            {/* Main tabs */}
            <div className="cc-props-tabs">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            className={`cc-props-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            <Icon size={14} />
                            <span>{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* VIDEO TAB */}
            {activeTab === 'video' && (
                <div className="cc-props-content">
                    {/* Sub tabs */}
                    <div className="cc-props-subtabs">
                        {SUB_TABS.map(st => (
                            <button
                                key={st}
                                className={`cc-props-subtab ${activeSubTab === st ? 'active' : ''}`}
                                onClick={() => setActiveSubTab(st)}
                            >
                                {st}
                            </button>
                        ))}
                    </div>

                    {activeSubTab === 'Basic' && (
                        <>
                            {/* Transform */}
                            <div className="cc-props-section">
                                <div className="cc-props-section-header">
                                    <Move size={14} />
                                    <span>Transform</span>
                                </div>

                                {/* Scale */}
                                <div className="cc-props-row">
                                    <label>Scale</label>
                                    <div className="cc-props-slider-row">
                                        <input
                                            type="range" min="10" max="200" step="1"
                                            value={activeClip.transform?.scale || 100}
                                            onChange={(e) => updateTransform('scale', parseFloat(e.target.value))}
                                            onMouseUp={handleSliderRelease}
                                        />
                                        <span className="cc-props-value">{activeClip.transform?.scale || 100}%</span>
                                    </div>
                                </div>

                                {/* Position */}
                                <div className="cc-props-row">
                                    <label>Position</label>
                                    <div className="cc-props-dual-input">
                                        <div className="cc-props-input-group">
                                            <span>X</span>
                                            <input
                                                type="number"
                                                value={activeClip.transform?.x || 0}
                                                onChange={(e) => updateTransform('x', parseFloat(e.target.value) || 0)}
                                                onBlur={handleSliderRelease}
                                            />
                                        </div>
                                        <div className="cc-props-input-group">
                                            <span>Y</span>
                                            <input
                                                type="number"
                                                value={activeClip.transform?.y || 0}
                                                onChange={(e) => updateTransform('y', parseFloat(e.target.value) || 0)}
                                                onBlur={handleSliderRelease}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Rotate */}
                                <div className="cc-props-row">
                                    <label><RotateCw size={12} /> Rotate</label>
                                    <div className="cc-props-slider-row">
                                        <input
                                            type="range" min="-180" max="180" step="0.1"
                                            value={activeClip.transform?.rotate || 0}
                                            onChange={(e) => updateTransform('rotate', parseFloat(e.target.value))}
                                            onMouseUp={handleSliderRelease}
                                        />
                                        <span className="cc-props-value">{(activeClip.transform?.rotate || 0).toFixed(1)}°</span>
                                    </div>
                                </div>

                                {/* Reset transform button */}
                                <button
                                    className="cc-props-reset-btn"
                                    onClick={() => {
                                        update('transform', { scale: 100, x: 0, y: 0, rotate: 0 });
                                        if (onSaveHistory) onSaveHistory();
                                    }}
                                >
                                    Reset Transform
                                </button>

                                {/* Alignment buttons */}
                                <div className="cc-props-row" style={{ marginTop: '12px' }}>
                                    <label><AlignCenter size={12} /> Align</label>
                                    <div className="cc-align-grid">
                                        {['↖', '↑', '↗', '←', '·', '→', '↙', '↓', '↘'].map((a, i) => (
                                            <button
                                                key={i}
                                                className="cc-align-btn"
                                                onClick={() => handleAlign(a)}
                                            >
                                                {a}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Transition */}
                            <div className="cc-props-section">
                                <div className="cc-props-section-header">
                                    <Sparkles size={14} />
                                    <span>Transition</span>
                                </div>
                                <div className="cc-filter-grid">
                                    {TRANSITIONS.map(t => (
                                        <button
                                            key={t.id}
                                            className={`cc-filter-chip ${activeClip.transition === t.id ? 'active' : ''}`}
                                            onClick={() => {
                                                update('transition', t.id);
                                                if (onSaveHistory) onSaveHistory();
                                            }}
                                        >
                                            {t.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Blend */}
                            <div className="cc-props-section">
                                <div className="cc-props-section-header">
                                    <Sparkles size={14} />
                                    <span>Blend</span>
                                </div>
                                <select className="cc-props-select" defaultValue="normal">
                                    <option value="normal">Normal</option>
                                    <option value="multiply">Multiply</option>
                                    <option value="screen">Screen</option>
                                    <option value="overlay">Overlay</option>
                                </select>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* AUDIO TAB */}
            {activeTab === 'audio' && (
                <div className="cc-props-content">
                    <div className="cc-props-section">
                        <div className="cc-props-row">
                            <label><Music size={12} /> Volume</label>
                            <div className="cc-props-slider-row">
                                <input
                                    type="range" min="0" max="200" step="1"
                                    value={Math.round((activeClip.volume || 1) * 100)}
                                    onChange={(e) => update('volume', parseInt(e.target.value) / 100)}
                                    onMouseUp={handleSliderRelease}
                                />
                                <span className="cc-props-value">{Math.round((activeClip.volume || 1) * 100)}%</span>
                            </div>
                        </div>
                        {/* Mute button */}
                        <button
                            className="cc-props-reset-btn"
                            onClick={() => {
                                update('volume', activeClip.volume === 0 ? 1 : 0);
                                if (onSaveHistory) onSaveHistory();
                            }}
                        >
                            {activeClip.volume === 0 ? '🔊 Unmute' : '🔇 Mute'}
                        </button>
                    </div>
                </div>
            )}

            {/* SPEED TAB */}
            {activeTab === 'speed' && (
                <div className="cc-props-content">
                    <div className="cc-props-section">
                        <div className="cc-props-row">
                            <label><Gauge size={12} /> Playback Speed</label>
                            <div className="cc-speed-curve">
                                {SPEED_PRESETS.map(s => (
                                    <button
                                        key={s}
                                        className={`cc-speed-dot ${activeClip.speed === s ? 'active' : ''}`}
                                        onClick={() => {
                                            update('speed', s);
                                            if (onSaveHistory) onSaveHistory();
                                        }}
                                    >
                                        {s}x
                                    </button>
                                ))}
                            </div>
                            <div className="cc-props-slider-row" style={{ marginTop: '12px' }}>
                                <input
                                    type="range" min="0.1" max="10" step="0.1"
                                    value={activeClip.speed || 1}
                                    onChange={(e) => update('speed', parseFloat(e.target.value))}
                                    onMouseUp={handleSliderRelease}
                                />
                                <span className="cc-props-value">{(activeClip.speed || 1).toFixed(1)}x</span>
                            </div>
                        </div>
                        {/* Reset speed */}
                        <button
                            className="cc-props-reset-btn"
                            onClick={() => {
                                update('speed', 1);
                                if (onSaveHistory) onSaveHistory();
                            }}
                        >
                            Reset to 1x
                        </button>
                    </div>
                </div>
            )}

            {/* TEXT TAB */}
            {activeTab === 'text' && (
                <div className="cc-props-content">
                    <div className="cc-props-section">
                        <div className="cc-props-section-header">
                            <Type size={14} />
                            <span>Text Overlays</span>
                        </div>

                        {/* Add new overlay */}
                        <div className="cc-props-add-overlay">
                            <input
                                type="text"
                                className="cc-props-text-input"
                                placeholder="Enter text..."
                                value={newOverlayText}
                                onChange={(e) => setNewOverlayText(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addTextOverlay()}
                            />
                            <button className="cc-props-add-btn" onClick={addTextOverlay}>
                                <Plus size={14} /> Add
                            </button>
                        </div>

                        {/* Existing overlays */}
                        {(activeClip.textOverlays || []).map((overlay, i) => (
                            <div key={i} className="cc-props-overlay-item">
                                <div className="cc-props-overlay-header">
                                    <input
                                        type="text"
                                        className="cc-props-text-input"
                                        value={overlay.text}
                                        onChange={(e) => updateTextOverlay(i, 'text', e.target.value)}
                                        onBlur={handleSliderRelease}
                                    />
                                    <button
                                        className="cc-props-overlay-delete"
                                        onClick={() => removeTextOverlay(i)}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                                <div className="cc-props-row">
                                    <label>Size</label>
                                    <div className="cc-props-slider-row">
                                        <input
                                            type="range" min="12" max="120" step="1"
                                            value={overlay.size || 32}
                                            onChange={(e) => updateTextOverlay(i, 'size', parseInt(e.target.value))}
                                            onMouseUp={handleSliderRelease}
                                        />
                                        <span className="cc-props-value">{overlay.size || 32}px</span>
                                    </div>
                                </div>
                                <div className="cc-props-row">
                                    <label>Color</label>
                                    <input
                                        type="color"
                                        className="cc-props-color-input"
                                        value={overlay.color || '#ffffff'}
                                        onChange={(e) => updateTextOverlay(i, 'color', e.target.value)}
                                        onBlur={handleSliderRelease}
                                    />
                                </div>
                                <div className="cc-props-row">
                                    <label>Position</label>
                                    <div className="cc-props-dual-input">
                                        <div className="cc-props-input-group">
                                            <span>X</span>
                                            <input
                                                type="number"
                                                value={overlay.x || 50}
                                                onChange={(e) => updateTextOverlay(i, 'x', parseInt(e.target.value) || 0)}
                                                onBlur={handleSliderRelease}
                                            />
                                        </div>
                                        <div className="cc-props-input-group">
                                            <span>Y</span>
                                            <input
                                                type="number"
                                                value={overlay.y || 80}
                                                onChange={(e) => updateTextOverlay(i, 'y', parseInt(e.target.value) || 0)}
                                                onBlur={handleSliderRelease}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="cc-props-row">
                                    <label>Timing (seconds)</label>
                                    <div className="cc-props-dual-input">
                                        <div className="cc-props-input-group">
                                            <span>Start</span>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                value={overlay.start || 0}
                                                onChange={(e) => updateTextOverlay(i, 'start', parseFloat(e.target.value) || 0)}
                                                onBlur={handleSliderRelease}
                                            />
                                        </div>
                                        <div className="cc-props-input-group">
                                            <span>End</span>
                                            <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                value={overlay.end || 3}
                                                onChange={(e) => updateTextOverlay(i, 'end', parseFloat(e.target.value) || 3)}
                                                onBlur={handleSliderRelease}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {(activeClip.textOverlays || []).length === 0 && (
                            <p className="cc-props-hint">No text overlays yet. Add one above.</p>
                        )}
                    </div>
                </div>
            )}

            {/* ADJUST TAB */}
            {activeTab === 'adjust' && (
                <div className="cc-props-content">
                    <div className="cc-props-section">
                        <div className="cc-props-section-header">
                            <Sun size={14} />
                            <span>Colour Filter</span>
                        </div>
                        <div className="cc-filter-grid">
                            {FILTERS.map(f => (
                                <button
                                    key={f.id}
                                    className={`cc-filter-chip ${activeClip.filter === f.id ? 'active' : ''}`}
                                    onClick={() => {
                                        update('filter', f.id);
                                        if (onSaveHistory) onSaveHistory();
                                    }}
                                >
                                    {f.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* AI STYLIZE TAB */}
            {activeTab === 'ai' && (
                <div className="cc-props-content">
                    <div className="cc-props-section">
                        <div className="cc-props-section-header">
                            <Sparkles size={14} />
                            <span>AI Stylize</span>
                        </div>
                        <p className="cc-props-hint">
                            AI-powered video stylization requires the Python backend to be running.
                            Start it with: <code>python server/python-editor/main.py</code>
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

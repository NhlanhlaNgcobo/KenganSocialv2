import {
    Image, Music, Type, Smile, Sparkles, ArrowLeftRight,
    Captions, SlidersHorizontal, Sun
} from 'lucide-react';

const TOOLS = [
    { id: 'media', label: 'Media', icon: Image },
    { id: 'audio', label: 'Audio', icon: Music },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'stickers', label: 'Stickers', icon: Smile },
    { id: 'effects', label: 'Effects', icon: Sparkles },
    { id: 'transitions', label: 'Transitions', icon: ArrowLeftRight },
    { id: 'captions', label: 'Captions', icon: Captions },
    { id: 'filters', label: 'Filters', icon: SlidersHorizontal },
    { id: 'adjust', label: 'Adjust', icon: Sun },
];

export default function EditorToolbar({ activeTool, onToolChange }) {
    return (
        <div className="cc-toolbar">
            {TOOLS.map(tool => {
                const Icon = tool.icon;
                return (
                    <button
                        key={tool.id}
                        className={`cc-toolbar-btn ${activeTool === tool.id ? 'active' : ''}`}
                        onClick={() => onToolChange(tool.id)}
                        title={tool.label}
                    >
                        <Icon size={18} />
                        <span>{tool.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

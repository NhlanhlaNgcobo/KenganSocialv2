import type { ComponentType } from 'react';
import { Captions, Clapperboard, Film, LayoutTemplate, MicVocal, Music, Settings2, Sparkles, Type } from 'lucide-react';
import { useUiStore, type PanelTab } from '../../stores/ui-store';
import { AiView } from './AiView';
import { CaptionsView } from './CaptionsView';
import { LyricsView } from './LyricsView';
import { MediaView } from './MediaView';
import { MusicView } from './MusicView';
import { SettingsView } from './SettingsView';
import { StockView } from './StockView';
import { TemplatesView } from './TemplatesView';
import { TextView } from './TextView';

const TABS: { id: PanelTab; label: string; icon: typeof Film }[] = [
    { id: 'media', label: 'Media', icon: Film },
    { id: 'templates', label: 'Templates', icon: LayoutTemplate },
    { id: 'music', label: 'Music', icon: Music },
    { id: 'lyrics', label: 'Lyrics', icon: MicVocal },
    { id: 'stock', label: 'Stock', icon: Clapperboard },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'captions', label: 'Captions', icon: Captions },
    { id: 'ai', label: 'AI Edit', icon: Sparkles },
    { id: 'settings', label: 'Settings', icon: Settings2 },
];

const VIEWS: Record<PanelTab, ComponentType> = {
    media: MediaView,
    templates: TemplatesView,
    music: MusicView,
    lyrics: LyricsView,
    stock: StockView,
    text: TextView,
    captions: CaptionsView,
    ai: AiView,
    settings: SettingsView,
};

export function MediaPanel() {
    const activeTab = useUiStore((s) => s.activeTab);
    const setActiveTab = useUiStore((s) => s.setActiveTab);
    const View = VIEWS[activeTab];

    return (
        <div className="ke-panel ke-media-panel">
            <nav className="ke-tabbar" aria-label="Editor tools">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        className={`ke-tabbar__item ${activeTab === tab.id ? 'is-active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                        title={tab.label}
                    >
                        <tab.icon size={18} />
                        <span>{tab.label}</span>
                    </button>
                ))}
            </nav>
            <div className="ke-media-panel__view">
                <View />
            </div>
        </div>
    );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Download, Keyboard, Wand2 } from 'lucide-react';
import { useAiEditStore } from '../stores/ai-edit-store';
import { useProjectStore } from '../stores/project-store';
import { useUiStore } from '../stores/ui-store';
import { SHORTCUTS } from '../hooks/use-editor-shortcuts';

export function EditorHeader() {
    const { name, setName, lastSavedAt } = useProjectStore();
    const setExportOpen = useUiStore((s) => s.setExportOpen);
    const openAiEdit = useAiEditStore((s) => s.openStudio);
    const aiEditBusy = useAiEditStore((s) => s.edit.running || s.analysis.running);
    const [showKeys, setShowKeys] = useState(false);

    return (
        <header className="ke-header">
            <div className="ke-header__left">
                <Link to="/dashboard" className="ke-icon-btn" title="Back to dashboard" aria-label="Back to dashboard">
                    <ChevronLeft size={18} />
                </Link>
                <input className="ke-header__name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
                <span className="ke-muted ke-header__saved">
                    {lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not saved yet'}
                </span>
            </div>
            <div className="ke-header__right">
                <div className="ke-popover-anchor">
                    <button className="ke-icon-btn" title="Keyboard shortcuts" onClick={() => setShowKeys((v) => !v)}>
                        <Keyboard size={17} />
                    </button>
                    {showKeys ? (
                        <div className="ke-popover" onMouseLeave={() => setShowKeys(false)}>
                            <h4>Shortcuts</h4>
                            {SHORTCUTS.map(([keys, label]) => (
                                <div key={keys} className="ke-shortcut">
                                    <span>{label}</span>
                                    <kbd>{keys}</kbd>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
                <button className={`ke-btn ke-btn--ai ${aiEditBusy ? 'is-busy' : ''}`} onClick={openAiEdit} title="Edit your footage in the style of a reference video">
                    <Wand2 size={15} /> AI edit{aiEditBusy ? '…' : ''}
                </button>
                <button className="ke-btn ke-btn--primary" onClick={() => setExportOpen(true)}>
                    <Download size={15} /> Export
                </button>
            </div>
        </header>
    );
}

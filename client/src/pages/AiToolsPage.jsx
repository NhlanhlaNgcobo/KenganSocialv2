import { useState } from 'react';
import {
    Sparkles,
    MessageSquare,
    Hash,
    FileText,
    Zap,
    Copy,
    RefreshCw,
    Send,
    Check,
    AlertCircle,
    Target,
    Wand2,
    Image as ImageIcon
} from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { apiClient } from '../lib/api';
import './AiTools.css';

const AI_TOOLS = [
    { id: 'caption', name: 'Caption Generator', icon: MessageSquare, description: 'Generate engaging captions for any platform in seconds.' },
    { id: 'hashtags', name: 'Hashtag Generator', icon: Hash, description: 'Get relevant, trending hashtags to boost your reach.' },
    { id: 'script', name: 'Video Script Writer', icon: FileText, description: 'Professional scripts for TikToks, Reels, and Shorts.' },
    { id: 'hook', name: 'Hook Generator', icon: Zap, description: 'Scroll-stopping opening lines for your content.' },
    { id: 'research', name: 'Competitor Research', icon: Target, description: 'Type an industry to get 5 optimal ad directions.' },
    { id: 'nanobanana', name: 'Nanobanana Creator', icon: Wand2, description: 'Create viral, high-energy Nanobanana style content.' },
];

export default function AiToolsPage() {
    const { currentWorkspace } = useWorkspace();
    const [selectedTool, setSelectedTool] = useState('caption');
    const [input, setInput] = useState('');
    const [tone, setTone] = useState('Professional');
    const [language, setLanguage] = useState('English');
    const [result, setResult] = useState('');
    const [provider, setProvider] = useState('');
    const [credits, setCredits] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [mediaLoading, setMediaLoading] = useState(false);
    const [mediaUrl, setMediaUrl] = useState('');

    const handleGenerate = async () => {
        if (!currentWorkspace?.id) return;
        setLoading(true);
        setError('');
        setResult('');
        setMediaUrl('');

        try {
            const data = await apiClient('/ai/generate', {
                method: 'POST',
                body: JSON.stringify({
                    workspaceId: currentWorkspace.id,
                    prompt: input,
                    type: selectedTool,
                    tone,
                    language,
                }),
            });

            setResult(data.result);
            setProvider(data.provider);
            setCredits(data.remainingCredits);
        } catch (err) {
            setError(err.message || 'Generation failed. Check your API keys.');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(result);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleGenerateMedia = async () => {
        if (!currentWorkspace?.id || !result) return;
        setMediaLoading(true);
        setError('');
        setMediaUrl('');

        try {
            const data = await apiClient('/ai/generate-media', {
                method: 'POST',
                body: JSON.stringify({
                    workspaceId: currentWorkspace.id,
                    prompt: result, // use the AI generated result as prompt,
                    type: selectedTool,
                }),
            });

            setMediaUrl(data.mediaUrl);
            setCredits(data.remainingCredits);
        } catch (err) {
            setError(err.message || 'Media generation failed. Credits missing?');
        } finally {
            setMediaLoading(false);
        }
    };

    return (
        <div className="ai-tools-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>AI Content Tools</h1>
                    <p className="page-subtitle">Supercharge your content with advanced AI generation.</p>
                </div>
                {credits !== null && (
                    <div className="credits-badge glass">
                        <Sparkles size={14} /> {credits} credits remaining
                    </div>
                )}
            </div>

            <div className="ai-layout">
                {/* Tool Selection Sidebar */}
                <div className="ai-sidebar">
                    {AI_TOOLS.map(tool => (
                        <button
                            key={tool.id}
                            className={`ai-tool-card card glass ${selectedTool === tool.id ? 'active' : ''}`}
                            onClick={() => { setSelectedTool(tool.id); setResult(''); setError(''); }}
                        >
                            <div className="tool-icon-wrapper">
                                <tool.icon size={20} />
                            </div>
                            <div className="tool-info">
                                <h3>{tool.name}</h3>
                                <p>{tool.description}</p>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Workspace */}
                <div className="ai-workspace card animate-slide-in">
                    <div className="workspace-header">
                        <div className="flex items-center gap-sm">
                            <Sparkles size={20} className="text-brand" />
                            <h2>{AI_TOOLS.find(t => t.id === selectedTool).name}</h2>
                        </div>
                    </div>

                    <div className="workspace-body">
                        <div className="input-section">
                            <label>What is your post about?</label>
                            <textarea
                                placeholder="e.g. A new luxury watch collection launch for summer..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                className="input"
                            />
                            <div className="input-options">
                                <div className="flex gap-md">
                                    <select className="input input-sm" value={tone} onChange={e => setTone(e.target.value)}>
                                        <option>Professional</option>
                                        <option>Witty</option>
                                        <option>Inspirational</option>
                                        <option>Urgent</option>
                                    </select>
                                    <select className="input input-sm" value={language} onChange={e => setLanguage(e.target.value)}>
                                        <option value="English">English</option>
                                        <option value="Zulu">isiZulu</option>
                                        <option value="Xhosa">isiXhosa</option>
                                        <option value="Afrikaans">Afrikaans</option>
                                        <option value="Sepedi">Sepedi (Northern Sotho)</option>
                                        <option value="Tswana">Setswana</option>
                                        <option value="Southern Sotho">Sesotho (Southern Sotho)</option>
                                        <option value="Tsonga">Xitsonga</option>
                                        <option value="Swati">siSwati</option>
                                        <option value="Venda">Tshivenda</option>
                                        <option value="Southern Ndebele">isiNdebele</option>
                                    </select>
                                </div>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleGenerate}
                                    disabled={loading || !input}
                                >
                                    {loading ? (
                                        <><RefreshCw size={18} className="spin" /> Generating...</>
                                    ) : (
                                        <><Sparkles size={18} /> Generate</>
                                    )}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="error-banner animate-fade-in">
                                <AlertCircle size={16} />
                                <span>{error}</span>
                            </div>
                        )}

                        {result && (
                            <div className="result-section animate-fade-in">
                                <div className="result-header">
                                    <span>AI Generated Content <span className="provider-tag">via {provider}</span></span>
                                    <div className="flex gap-sm">
                                        <button className="btn-icon btn-ghost" title="Copy" onClick={handleCopy}>
                                            {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                                        </button>
                                        <button className="btn-icon btn-ghost" title="Send to Studio"><Send size={16} /></button>
                                    </div>
                                </div>
                                <div className="result-content glass">
                                    <p style={{ whiteSpace: 'pre-wrap' }}>{result}</p>
                                </div>

                                <div style={{ marginTop: '16px' }}>
                                    {!mediaUrl && !mediaLoading ? (
                                        <button className="btn btn-secondary full-width" onClick={handleGenerateMedia}>
                                            <ImageIcon size={18} /> Generate Visual Workflow Content (2 Credits)
                                        </button>
                                    ) : mediaLoading ? (
                                        <div className="flex justify-center p-md">
                                            <RefreshCw size={24} className="spin text-brand" />
                                        </div>
                                    ) : (
                                        <div className="generated-media animate-slide-in mt-md">
                                            <h4 style={{ marginBottom: '8px' }}>Visually Rendered Output:</h4>
                                            <img src={mediaUrl} alt="AI Generated" style={{ width: '100%', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }} />
                                            <a href={mediaUrl} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ marginTop: '8px' }}>View Full Resolution</a>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

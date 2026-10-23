import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
    { id: 'caption', name: 'Captions', icon: MessageSquare, description: 'A caption for one platform, in your voice.' },
    { id: 'hashtags', name: 'Hashtags', icon: Hash, description: 'A mix of broad and niche hashtags for a topic.' },
    { id: 'script', name: 'Video script', icon: FileText, description: 'A 30–60 second script for TikTok, Reels or Shorts.' },
    { id: 'hook', name: 'Hooks', icon: Zap, description: 'Opening lines for the first two seconds of a video.' },
    { id: 'research', name: 'Ad angles', icon: Target, description: 'Five ad directions for an industry.' },
    { id: 'nanobanana', name: 'Nanobanana style', icon: Wand2, description: 'High-energy, fast-cut ideas in the Nanobanana style.' },
];

export default function AiToolsPage() {
    const { currentWorkspace } = useWorkspace();
    const navigate = useNavigate();
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
    // null = unknown (still checking); false = no image provider configured on the server.
    const [imageGeneration, setImageGeneration] = useState(null);
    const workspaceId = currentWorkspace?.id;

    useEffect(() => {
        if (!workspaceId) return;
        let cancelled = false;
        apiClient(`/ai/credits/${workspaceId}`)
            .then((data) => !cancelled && typeof data.credits === 'number' && setCredits(data.credits))
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [workspaceId]);

    useEffect(() => {
        let cancelled = false;
        apiClient('/ai/status')
            .then((data) => !cancelled && setImageGeneration(Boolean(data.imageGeneration)))
            .catch(() => !cancelled && setImageGeneration(null));
        return () => {
            cancelled = true;
        };
    }, []);

    const handleGenerate = async () => {
        if (!currentWorkspace?.id) {
            setError('Create or pick a workspace first. AI credits belong to a workspace.');
            return;
        }
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
            setError(err.message || 'Generation failed. Try again in a moment.');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(result);
        } catch {
            setError("Couldn't copy to the clipboard. Select the text and copy it manually.");
            return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleGenerateMedia = async () => {
        if (!result) return;
        if (!currentWorkspace?.id) {
            setError('Create or pick a workspace first. AI credits belong to a workspace.');
            return;
        }
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
            if (typeof data.remainingCredits === 'number') setCredits(data.remainingCredits);
        } catch (err) {
            if (err.code === 'IMAGE_GENERATION_UNAVAILABLE') setImageGeneration(false);
            setError(err.message || "The image couldn't be generated. Try again.");
        } finally {
            setMediaLoading(false);
        }
    };

    return (
        <div className="ai-tools-page animate-fade-in">
            <div className="page-header">
                <div>
                    <h1>AI writer</h1>
                    <p className="page-subtitle">Write captions, hooks, hashtags and scripts. Edit the result before you post.</p>
                </div>
                {credits !== null && (
                    <div className="credits-badge glass">
                        <Sparkles size={14} /> {credits} credits remaining
                    </div>
                )}
            </div>

            {!workspaceId ? (
                <div className="error-banner">
                    <AlertCircle size={16} />
                    <span>
                        You need a workspace to use the AI writer. <Link to="/onboarding">Create a workspace</Link>
                    </span>
                </div>
            ) : null}

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
                                    disabled={loading || !input || !workspaceId}
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
                                        <button
                                            className="btn-icon btn-ghost"
                                            title="Use as caption in Content Studio"
                                            onClick={() => navigate('/dashboard/content', { state: { caption: result } })}
                                        >
                                            <Send size={16} />
                                        </button>
                                    </div>
                                </div>
                                <div className="result-content glass">
                                    <p style={{ whiteSpace: 'pre-wrap' }}>{result}</p>
                                </div>

                                <div style={{ marginTop: '16px' }}>
                                    {!mediaUrl ? (
                                        <>
                                            <button
                                                className="btn btn-secondary full-width"
                                                onClick={handleGenerateMedia}
                                                disabled={mediaLoading || imageGeneration === false || !workspaceId}
                                                title={imageGeneration === false ? "Image generation isn't set up on this server yet" : undefined}
                                            >
                                                {mediaLoading ? (
                                                    <><RefreshCw size={18} className="spin" /> Generating image…</>
                                                ) : (
                                                    <><ImageIcon size={18} /> Generate an image for this post (5 credits)</>
                                                )}
                                            </button>
                                            {imageGeneration === false ? (
                                                <p className="muted" style={{ marginTop: '6px', fontSize: '12.5px' }}>
                                                    Image generation isn't set up yet. An admin needs to add POLLINATIONS_API_KEY (free) or OPENROUTER_API_KEY to the server.
                                                </p>
                                            ) : null}
                                        </>
                                    ) : (
                                        <div className="generated-media animate-slide-in mt-md">
                                            <h4 style={{ marginBottom: '8px' }}>Generated image</h4>
                                            <img src={mediaUrl} alt="AI-generated illustration for this post" style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--border-primary)' }} />
                                            <div className="flex gap-sm" style={{ marginTop: '8px' }}>
                                                <a href={mediaUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Open full size</a>
                                                <button className="btn btn-ghost btn-sm" onClick={handleGenerateMedia} disabled={mediaLoading}>
                                                    <RefreshCw size={14} className={mediaLoading ? 'spin' : undefined} /> Try another (5 credits)
                                                </button>
                                            </div>
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

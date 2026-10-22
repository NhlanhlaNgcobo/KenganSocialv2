import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, CheckCircle2, Circle, Globe, GraduationCap, LayoutGrid, Loader2, Megaphone, Palette, Swords, Wand2 } from 'lucide-react';
import GuidedTutorial, { useTutorial } from '../../components/tutorial/GuidedTutorial';
import { MARKETING_TUTORIAL } from '../../components/tutorial/marketingTutorial';
import { useAuth } from '../../context/AuthContext';
import { marketingApi } from '../../lib/marketing-api';
import BrandKitPanel from './BrandKitPanel';
import BrandVoicePanel from './BrandVoicePanel';
import ReferenceLibrary from './ReferenceLibrary';
import BrandPreview from './BrandPreview';
import BusinessProfilePanel from './BusinessProfilePanel';
import CarouselStudio from './CarouselStudio';
import VideoAdStudio from './VideoAdStudio';
import WebsiteSetup from './WebsiteSetup';
import './Marketing.css';

/**
 * Marketing: the brand kit, references and voice that every piece of content is made from,
 * plus (in later phases) carousels, competitor research, website insights and paid ads.
 */

const TABS = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'brand', label: 'Brand', icon: Palette },
    { id: 'create', label: 'Create', icon: Wand2 },
    { id: 'video-ads', label: 'Video Ads', icon: Megaphone },
    { id: 'competitors', label: 'Competitors', icon: Swords },
    { id: 'website', label: 'Website', icon: Globe },
    { id: 'ads', label: 'Ads', icon: Megaphone },
];

const COMING = {
    competitors: {
        title: 'Competitor research',
        text: "Benchmark your Instagram and YouTube against competitors, see their top posts this month, get an AI brief on their offers and positioning, open their live ads in the official ad libraries, and keep a swipe file of ads you like.",
    },
    website: {
        title: 'Website insights',
        text: 'Paste your website to get Google speed and SEO scores, real-visitor Core Web Vitals, an SEO checklist, broken links, your tech stack and a top-5 list of fixes, all tracked over time.',
    },
    ads: {
        title: 'Paid ads',
        text: 'Connect Meta and TikTok ad accounts to see spend, results, cost per result and ROAS by campaign, your best-performing ads, and an AI read-out of what to scale, pause or make next.',
    },
};

export default function MarketingPage() {
    const [params, setParams] = useSearchParams();
    const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const tutorial = useTutorial(MARKETING_TUTORIAL.id);

    const load = useCallback(async () => {
        try {
            setError('');
            setData(await marketingApi.brand());
        } catch (err) {
            setError(err.message);
        }
    }, []);

    useEffect(() => {
        let active = true;
        marketingApi
            .brand()
            .then((d) => active && setData(d))
            .catch((err) => active && setError(err.message));
        return () => {
            active = false;
        };
    }, []);

    const go = (id) => setParams(id === 'overview' ? {} : { tab: id });
    const makeCarousels = () => setParams({ tab: 'create', source: 'website' });

    return (
        <div className="marketing-page">
            <header className="page-head">
                <div>
                    <h1>Marketing</h1>
                    <p>Your brand in one place. Create carousels and narrated product ads from your website or product photos.</p>
                </div>
                <button className="btn btn-secondary gt-open" onClick={tutorial.show}>
                    <GraduationCap size={16} /> How it works
                </button>
            </header>
            <GuidedTutorial id={MARKETING_TUTORIAL.id} title={MARKETING_TUTORIAL.title} steps={MARKETING_TUTORIAL.steps} open={tutorial.open} onClose={tutorial.close} />

            <div className="segmented marketing-tabs" role="tablist" aria-label="Marketing sections">
                {TABS.map((t) => (
                    <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => go(t.id)}>
                        <t.icon size={15} /> {t.label}
                    </button>
                ))}
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
            {!data && !error ? (
                <div className="surface marketing-loading">
                    <Loader2 size={18} className="spin" /> Loading your brand…
                </div>
            ) : null}

            {data && tab === 'overview' ? <Overview data={data} go={go} onSetupDone={load} onMakeCarousels={makeCarousels} /> : null}

            {data && tab === 'brand' ? (
                <div className="marketing-brand">
                    <div className="marketing-brand__main">
                        <WebsiteSetup compact initialUrl={data.kit.website} onDone={load} onMakeCarousels={makeCarousels} />
                        <BrandKitPanel data={data} onSaved={setData} />
                        <BusinessProfilePanel data={data} onSaved={setData} />
                        <BrandVoicePanel data={data} onSaved={setData} />
                        <ReferenceLibrary aiAvailable={data.aiAvailable} kit={data.kit} onKitChange={setData} onCountChange={load} />
                    </div>
                    <aside className="marketing-brand__side">
                        <BrandPreview kit={data.kit} />
                        <Completeness completeness={data.completeness} />
                    </aside>
                </div>
            ) : null}

            {data && tab === 'create' ? <CarouselStudio kit={data.kit} initialSource={params.get('source') === 'website' || data.kit.website ? 'website' : 'topic'} /> : null}
            {data && tab === 'video-ads' ? <VideoAdStudio kit={data.kit} /> : null}

            {data && COMING[tab] ? <ComingNext {...COMING[tab]} onBrand={() => go('brand')} brandScore={data.completeness.score} /> : null}
        </div>
    );
}

function Completeness({ completeness }) {
    return (
        <section className="surface marketing-completeness">
            <div className="marketing-completeness__head">
                <h3>Brand kit</h3>
                <strong>{completeness.score}%</strong>
            </div>
            <div className="progress">
                <div style={{ width: `${completeness.score}%` }} />
            </div>
            <ul>
                {completeness.checks.map((c) => (
                    <li key={c.id} className={c.done ? 'is-done' : ''}>
                        {c.done ? <CheckCircle2 size={15} /> : <Circle size={15} />} {c.label}
                    </li>
                ))}
            </ul>
        </section>
    );
}

function Overview({ data, go, onSetupDone, onMakeCarousels }) {
    const { plan } = useAuth();
    const { kit, completeness } = data;
    const next = completeness.checks.find((c) => !c.done);
    return (
        <div className="marketing-overview">
            <WebsiteSetup compact={completeness.score >= 100} initialUrl={kit.website} onDone={onSetupDone} onMakeCarousels={onMakeCarousels} />
            <section className="surface marketing-hero">
                <div className="marketing-hero__brand">
                    {kit.logo?.primary ? <img src={kit.logo.primary} alt="" /> : <div className="marketing-hero__placeholder">{(kit.name || 'B').charAt(0).toUpperCase()}</div>}
                    <div>
                        <h2>{kit.name || 'Set up your brand'}</h2>
                        <p className="muted">{kit.tagline || 'Your brand kit styles every carousel, ad and post the app makes for you.'}</p>
                        <div className="marketing-swatches">
                            {['primary', 'secondary', 'accent', 'background', 'text']
                                .map((role) => kit.colors?.[role])
                                .filter(Boolean)
                                .map((hex, i) => (
                                    <span key={`${hex}-${i}`} style={{ background: hex }} title={hex} />
                                ))}
                        </div>
                    </div>
                </div>
                <div className="marketing-hero__score">
                    <strong>{completeness.score}%</strong>
                    <span className="muted">brand kit complete</span>
                    <button className="btn btn-primary btn-sm" onClick={() => go('brand')}>
                        {next ? `Next: ${next.label.toLowerCase()}` : 'Review brand kit'}
                    </button>
                </div>
            </section>

            <div className="marketing-cards">
                {[
                    { id: 'create', icon: Wand2, title: 'Create carousels', text: 'On-brand slides from your website, a topic or text.', live: plan !== 'starter' },
                    { id: 'video-ads', icon: Megaphone, title: 'Create video ads', text: 'Product photos or a website. Voiceover, music, and up to 25 seconds.', live: plan !== 'starter' },
                    { id: 'competitors', icon: Swords, title: 'Competitors', text: "See what's working for similar brands." },
                    { id: 'website', icon: Globe, title: 'Website insights', text: 'Speed, SEO and a top-5 fix list.' },
                    { id: 'ads', icon: BarChart3, title: 'Paid ads', text: 'Meta and TikTok results in one view.' },
                ].map((c) => (
                    <button key={c.id} className="surface marketing-card" onClick={() => go(c.id)}>
                        <c.icon size={18} />
                        <strong>{c.title}</strong>
                        <span className="muted">{c.text}</span>
                        <span className={`badge ${c.live ? 'badge-success' : ''}`}>{c.live ? 'Ready' : c.id === 'create' ? 'Nano plan and up' : 'Coming next'}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

function ComingNext({ title, text, onBrand, brandScore }) {
    return (
        <section className="surface marketing-coming">
            <span className="badge">In development</span>
            <h2>{title}</h2>
            <p className="muted">{text}</p>
            {brandScore < 100 ? (
                <p>
                    It builds on your brand kit, which is {brandScore}% complete.{' '}
                    <button type="button" className="link-button" onClick={onBrand}>
                        Finish it now
                    </button>
                    .
                </p>
            ) : null}
        </section>
    );
}

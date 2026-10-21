/** Marketing walkthrough: website → brand kit → profile and voice → references → carousels. */
import { Globe, Image, Mic2, Sparkles, Type, Upload } from 'lucide-react';
import { Bar, Cursor, In, Pop, Press, Tick, Typed, Window } from './scenes';

const SWATCHES = ['#7C3AED', '#111827', '#F59E0B', '#F3F4F6'];

export const MARKETING_TUTORIAL = {
    id: 'marketing-v1',
    title: 'Get started with Marketing',
    steps: [
        {
            title: 'Start with your website',
            body: 'On Overview, paste your website address. KenganSocial reads the site and pulls out your logo, colours and fonts so you start with a brand kit instead of a blank page.',
            scene: (
                <>
                    <Window title="KenganSocial · Marketing · Overview">
                        <strong>Set up from your website</strong>
                        <In d={0.2} className="gt-input gt-input--focus">
                            <span className="gt-row">
                                <Globe size={12} />
                                <Typed d={0.4} text="https://yourbusiness.co.za" />
                            </span>
                        </In>
                        <In d={1.6} className="gt-row">
                            <Press d={2.4}>
                                <span className="gt-btn">Read my website</span>
                            </Press>
                        </In>
                        <In d={2.9}>
                            <span className="gt-label">Reading pages, logo, colours and fonts…</span>
                            <Bar d={3} value={100} />
                        </In>
                    </Window>
                    <Cursor from={[78, 20]} to={[27, 64]} d={1.3} t={1} />
                </>
            ),
        },
        {
            title: 'Check your brand kit',
            body: 'The Brand tab holds your logo, colours and fonts. Upload or replace a logo, adjust a colour, or import again from your website. Nothing is saved until you click Save.',
            scene: (
                <Window title="Marketing · Brand" wide>
                    <div className="gt-row" style={{ alignItems: 'stretch' }}>
                        <Pop d={0.2} className="gt-card" style={{ flex: '0 0 96px', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="gt-icon" style={{ background: 'var(--gradient-brand, #7c3aed)', width: 40, height: 40, borderRadius: 12 }}>
                                <Upload size={18} />
                            </span>
                            <span className="gt-label">Logo</span>
                        </Pop>
                        <div className="gt-card" style={{ flex: 1 }}>
                            <span className="gt-label">Colours</span>
                            <div className="gt-row">
                                {SWATCHES.map((c, i) => (
                                    <Pop key={c} d={0.5 + i * 0.18} className="gt-swatch" style={{ background: c }} />
                                ))}
                            </div>
                            <span className="gt-label">Fonts</span>
                            <In d={1.4} className="gt-row">
                                <Type size={13} />
                                <strong style={{ fontSize: 15 }}>Headings · Space Grotesk</strong>
                            </In>
                            <In d={1.7} className="gt-row">
                                <Type size={11} />
                                <span>Body · Inter</span>
                            </In>
                        </div>
                    </div>
                    <In d={2.2} className="gt-row gt-row--between">
                        <span className="gt-chip gt-chip--ok">Brand kit 80% complete</span>
                        <Press d={2.9}>
                            <span className="gt-btn">Save</span>
                        </Press>
                    </In>
                </Window>
            ),
        },
        {
            title: 'Describe your business and how you sound',
            body: 'Fill in the business profile (what you sell, who to, where) and your brand voice (words you use and avoid). Every carousel and caption is written from these, so a few honest lines go a long way.',
            scene: (
                <Window title="Marketing · Brand">
                    <In d={0.1} className="gt-card">
                        <span className="gt-label">Business profile</span>
                        <Typed d={0.4} text="Fitness coaching for busy parents in Durban" />
                    </In>
                    <In d={1.9} className="gt-card">
                        <span className="gt-row">
                            <Mic2 size={12} />
                            <span className="gt-label">Brand voice</span>
                        </span>
                        <div className="gt-row" style={{ flexWrap: 'wrap' }}>
                            {['Warm', 'Direct', 'No jargon', 'Encouraging'].map((w, i) => (
                                <Pop key={w} d={2.2 + i * 0.2} className="gt-chip">
                                    {w}
                                </Pop>
                            ))}
                        </div>
                    </In>
                    <Tick d={3.2}>Saved to your brand</Tick>
                </Window>
            ),
        },
        {
            title: 'Add references you like',
            body: 'Upload posts and designs you want your content to feel like: yours that did well, or styles you admire. They guide the look of what you create.',
            scene: (
                <>
                    <Window title="Marketing · References" wide>
                        <div className="gt-grid">
                            {[0, 1, 2, 3].map((i) => (
                                <Pop key={i} d={0.3 + i * 0.3} className="gt-card gt-thumb" style={{ '--hue': `${250 + i * 30}` }}>
                                    <Image size={16} />
                                </Pop>
                            ))}
                        </div>
                        <In d={1.7} className="gt-row gt-row--between">
                            <span className="gt-label">4 references</span>
                            <Press d={2.2}>
                                <span className="gt-btn gt-btn--ghost">
                                    <Upload size={11} /> Upload
                                </span>
                            </Press>
                        </In>
                    </Window>
                    <Cursor from={[20, 25]} to={[85, 63]} d={1.2} t={1} />
                </>
            ),
        },
        {
            title: 'Create on-brand carousels',
            body: 'On Create, pick a topic or start from your website and KenganSocial drafts a carousel in your colours, fonts and voice. Edit any slide, then schedule it. Creating uses AI credits from your plan.',
            scene: (
                <Window title="Marketing · Create" wide>
                    <In d={0.1} className="gt-row gt-row--between">
                        <strong>5 tips to train at home</strong>
                        <Press d={0.6}>
                            <span className="gt-btn">
                                <Sparkles size={11} /> Create carousel
                            </span>
                        </Press>
                    </In>
                    <div className="gt-row gt-carousel">
                        {['Tip 1', 'Tip 2', 'Tip 3', 'Tip 4'].map((t, i) => (
                            <Pop key={t} d={1.1 + i * 0.3} className="gt-slide" style={{ background: SWATCHES[i % 3] }}>
                                <strong>{t}</strong>
                                <span>Your brand</span>
                            </Pop>
                        ))}
                    </div>
                    <In d={2.6} className="gt-row">
                        <span className="gt-chip gt-chip--ok">On brand</span>
                        <span className="gt-chip">Ready to schedule</span>
                    </In>
                </Window>
            ),
        },
    ],
};

/** Meta Ads walkthrough: from a Meta ad account to managing campaigns on the Ads page. */
import { Facebook, Instagram, Megaphone, Music2, Pause, Youtube } from 'lucide-react';
import { Bar, Cursor, In, Pop, Press, Tick, Typed, Window } from './scenes';

const PLATFORMS = [
    { name: 'Instagram', icon: Instagram, color: '#E1306C' },
    { name: 'Facebook', icon: Facebook, color: '#1877F2' },
    { name: 'TikTok', icon: Music2, color: '#111' },
    { name: 'YouTube', icon: Youtube, color: '#FF0000' },
];

export const META_ADS_TUTORIAL = {
    id: 'meta-ads-v1',
    title: 'Set up Meta Ads',
    steps: [
        {
            title: 'Have a Meta ad account ready',
            body: 'Your campaigns live in Meta Ads Manager. You need a Facebook account with admin or advertiser access to the ad account. Create campaigns in Ads Manager; KenganSocial shows how they perform and lets you pause, resume and change budgets.',
            scene: (
                <Window title="Meta Business Suite">
                    <In d={0.3} className="gt-row gt-row--between">
                        <div className="gt-row">
                            <span className="gt-icon" style={{ background: '#0866FF' }}>
                                <Megaphone size={14} />
                            </span>
                            <strong>Your Business ads</strong>
                        </div>
                        <span className="gt-chip gt-chip--ok">Active</span>
                    </In>
                    <Tick d={0.9}>A Facebook Page for the business</Tick>
                    <Tick d={1.4}>An ad account in Ads Manager</Tick>
                    <Tick d={1.9}>You are an admin or advertiser on it</Tick>
                    <In d={2.4} className="gt-chip">
                        Campaigns are created in Ads Manager
                    </In>
                </Window>
            ),
        },
        {
            title: 'Connect Meta Ads',
            body: 'Open Connections from the sidebar and click Connect on the Meta Ads card. You sign in with Facebook in a Meta window; KenganSocial never sees your Facebook password.',
            scene: (
                <>
                    <Window title="KenganSocial · Connections" wide>
                        <div className="gt-grid">
                            {PLATFORMS.map((p, i) => (
                                <In key={p.name} d={0.1 + i * 0.12} className="gt-card">
                                    <span className="gt-icon" style={{ background: p.color }}>
                                        <p.icon size={14} />
                                    </span>
                                    <span>{p.name}</span>
                                </In>
                            ))}
                            <In d={0.6} className="gt-card gt-card--accent">
                                <span className="gt-icon" style={{ background: '#0866FF' }}>
                                    <Megaphone size={14} />
                                </span>
                                <span>Meta Ads</span>
                                <Press d={2.1}>
                                    <span className="gt-btn">Connect</span>
                                </Press>
                            </In>
                        </div>
                    </Window>
                    <Cursor from={[20, 20]} to={[84, 70]} d={0.9} t={1.2} />
                    <Pop d={2.6} className="gt-float gt-float--left">
                        <strong>Continue with Facebook</strong>
                        <span className="gt-label">KenganSocial wants to manage your ads</span>
                        <span className="gt-btn gt-btn--meta">Continue as You</span>
                    </Pop>
                </>
            ),
        },
        {
            title: 'Allow access and choose the ad account',
            body: 'Meta asks you to allow reading your ads and managing them. Then pick which ad account to show. You can disconnect at any time from Connections, which also removes the data it brought in.',
            scene: (
                <>
                    <Window title="Facebook">
                        <strong>KenganSocial would like to</strong>
                        <Tick d={0.5}>See your ad performance (ads_read)</Tick>
                        <Tick d={1.0}>Pause, resume and set budgets (ads_management)</Tick>
                        <In d={1.5} className="gt-row">
                            <Press d={2.5}>
                                <span className="gt-btn gt-btn--meta">Allow</span>
                            </Press>
                        </In>
                    </Window>
                    <Cursor from={[70, 15]} to={[26, 74]} d={1.4} t={1.1} />
                    <Pop d={3.1} className="gt-float">
                        <strong>Choose an ad account</strong>
                        <div className="gt-input">Store ads · ZAR</div>
                        <div className="gt-input gt-input--focus">Your Business ads · ZAR</div>
                        <span className="gt-btn">Use this ad account</span>
                    </Pop>
                </>
            ),
        },
        {
            title: 'Read your results',
            body: 'The Ads page shows spend, results and cost per result for the period you choose, campaign by campaign. Use the reload button after making changes in Ads Manager.',
            scene: (
                <Window title="KenganSocial · Meta Ads" wide>
                    <In d={0.2} className="gt-row gt-row--between">
                        <strong>Your Business ads · ZAR</strong>
                        <span className="gt-input" style={{ minWidth: 110 }}>
                            <Typed d={0.6} text="Last 7 days" />
                        </span>
                    </In>
                    <div className="gt-grid">
                        {[
                            ['Spend', 'R 4 820', 78],
                            ['Results', '312 leads', 62],
                            ['Cost / result', 'R 15.45', 40],
                        ].map(([label, value, w], i) => (
                            <In key={label} d={1 + i * 0.25} className="gt-card">
                                <span className="gt-label">{label}</span>
                                <span className="gt-value">{value}</span>
                                <Bar d={1.3 + i * 0.25} value={w} tone={i === 2 ? 'success' : 'accent'} />
                            </In>
                        ))}
                    </div>
                    <In d={2.2} className="gt-row gt-row--between gt-card">
                        <span>Spring sale · Leads</span>
                        <span className="gt-chip gt-chip--ok">Active</span>
                    </In>
                </Window>
            ),
        },
        {
            title: 'Pause, resume and change budgets',
            body: 'Pause a campaign, resume it or set a new daily budget right from the list. Changes go live on Meta straight away, after you confirm, and every change is recorded under Activity.',
            scene: (
                <>
                    <Window title="KenganSocial · Meta Ads" wide>
                        <In d={0.1} className="gt-row gt-row--between gt-card">
                            <span>Spring sale · Leads</span>
                            <div className="gt-row">
                                <span className="gt-input gt-input--focus" style={{ minWidth: 86 }}>
                                    R <Typed d={1.6} text="350.00" />
                                </span>
                                <Press d={0.9}>
                                    <span className="gt-btn gt-btn--ghost">
                                        <Pause size={11} /> Pause
                                    </span>
                                </Press>
                            </div>
                        </In>
                        <In d={2.6} className="gt-card">
                            <span className="gt-label">Activity</span>
                            <span>Changed daily budget of Spring sale to R 350.00</span>
                        </In>
                        <In d={3.1} className="gt-chip gt-chip--warn">
                            Changes go live on Meta straight away
                        </In>
                    </Window>
                    <Cursor from={[30, 85]} to={[84, 33]} d={0.2} t={0.7} />
                </>
            ),
        },
    ],
};

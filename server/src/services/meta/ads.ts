import axios from 'axios';
import admin from 'firebase-admin';
import { db } from '../../utils/firestore';
import { decrypt } from '../../utils/tokenEncryption';
import { graphUrl, graphErrorMessage } from '../../config/meta';

/**
 * Meta Ads for the workspace's connected ad account (connection "meta_ads", routes/connections.ts):
 *  - campaigns with their results for a period (ads_read);
 *  - pausing, resuming and changing a campaign's daily budget, only when a person asks (ads_management).
 * Every change is checked to belong to the connected ad account and recorded in adsActivity.
 */

export class AdsError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

export const DATE_PRESETS = ['today', 'yesterday', 'last_7d', 'last_30d', 'this_month', 'last_month', 'maximum'] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

const wsRef = (workspaceId: string) => db.collection('workspaces').doc(workspaceId);

export async function getAdsConnection(workspaceId: string) {
    const snap = await wsRef(workspaceId).collection('connections').doc('meta_ads').get();
    const conn = snap.data();
    if (!snap.exists || !conn) throw new AdsError('Connect a Meta ad account first (Connections page).', 404);
    if (conn.status !== 'active') throw new AdsError('Reconnect Meta Ads: access has expired.', 409);
    return { adAccountId: String(conn.accountId), name: String(conn.accountName || ''), currency: conn.currency || null, token: decrypt(conn.accessToken) };
}

async function graphGet(path: string, params: Record<string, string>) {
    try {
        const { data } = await axios.get(graphUrl(path), { params, timeout: 20000 });
        return data;
    } catch (err: any) {
        throw new AdsError(`Meta Ads: ${graphErrorMessage(err)}`, err.response?.status === 400 ? 400 : 502);
    }
}

async function graphPost(path: string, params: Record<string, string>) {
    try {
        const { data } = await axios.post(graphUrl(path), null, { params, timeout: 20000 });
        return data;
    } catch (err: any) {
        throw new AdsError(`Meta Ads: ${graphErrorMessage(err)}`, err.response?.status === 400 ? 400 : 502);
    }
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Results Meta counts as the campaign's goal: the first of these action types it reports. */
const RESULT_ACTIONS = ['offsite_conversion.fb_pixel_purchase', 'lead', 'onsite_conversion.messaging_conversation_started_7d', 'link_click', 'video_view', 'post_engagement'];

function results(actions: any[] | undefined) {
    for (const type of RESULT_ACTIONS) {
        const a = (actions || []).find((x) => x.action_type === type);
        if (a) return { type, value: Number(a.value) };
    }
    return null;
}

export async function getAccountOverview(workspaceId: string, preset: DatePreset) {
    const { adAccountId, token } = await getAdsConnection(workspaceId);
    const [account, insights] = await Promise.all([
        graphGet(adAccountId, { fields: 'name,currency,account_status,timezone_name,amount_spent,spend_cap', access_token: token }),
        graphGet(`${adAccountId}/insights`, { date_preset: preset, fields: 'spend,impressions,reach,clicks,ctr,cpc', access_token: token }),
    ]);
    const i = insights?.data?.[0] || {};
    return {
        id: adAccountId,
        name: account.name,
        currency: account.currency,
        status: account.account_status,
        timezone: account.timezone_name,
        totals: { spend: num(i.spend), impressions: num(i.impressions), reach: num(i.reach), clicks: num(i.clicks), ctr: num(i.ctr), cpc: num(i.cpc) },
    };
}

export async function listCampaigns(workspaceId: string, preset: DatePreset) {
    const { adAccountId, token } = await getAdsConnection(workspaceId);
    const data = await graphGet(`${adAccountId}/campaigns`, {
        fields: `id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,insights.date_preset(${preset}){spend,impressions,reach,clicks,ctr,cpc,actions}`,
        limit: '100',
        access_token: token,
    });
    return (data?.data || [])
        .filter((c: any) => c.status !== 'DELETED' && c.status !== 'ARCHIVED')
        .map((c: any) => {
            const i = c.insights?.data?.[0] || {};
            return {
                id: c.id,
                name: c.name,
                status: c.status,
                effectiveStatus: c.effective_status,
                objective: c.objective,
                // Budgets are in the account currency's minor unit (cents); null when ad sets hold the budget.
                dailyBudget: num(c.daily_budget),
                lifetimeBudget: num(c.lifetime_budget),
                startTime: c.start_time || null,
                stopTime: c.stop_time || null,
                insights: { spend: num(i.spend), impressions: num(i.impressions), reach: num(i.reach), clicks: num(i.clicks), ctr: num(i.ctr), cpc: num(i.cpc), result: results(i.actions) },
            };
        });
}

/** The campaign, after checking it belongs to the connected ad account (so no other account can be changed). */
async function ownCampaign(adAccountId: string, token: string, campaignId: string) {
    if (!/^\d{5,30}$/.test(campaignId)) throw new AdsError('Unknown campaign.', 404);
    const c = await graphGet(campaignId, { fields: 'id,name,account_id,status,daily_budget,lifetime_budget', access_token: token });
    if (`act_${c.account_id}` !== adAccountId) throw new AdsError('That campaign is not in the connected ad account.', 403);
    return c;
}

async function logActivity(workspaceId: string, entry: Record<string, unknown>) {
    await wsRef(workspaceId)
        .collection('adsActivity')
        .add({ platform: 'meta_ads', ...entry, at: admin.firestore.FieldValue.serverTimestamp() });
}

export async function setCampaignStatus(workspaceId: string, uid: string, campaignId: string, status: 'ACTIVE' | 'PAUSED') {
    const { adAccountId, token } = await getAdsConnection(workspaceId);
    const campaign = await ownCampaign(adAccountId, token, campaignId);
    if (campaign.status === status) return { changed: false };
    await graphPost(campaignId, { status, access_token: token });
    await logActivity(workspaceId, { uid, action: status === 'PAUSED' ? 'pause' : 'resume', campaignId, campaignName: campaign.name, from: campaign.status, to: status });
    return { changed: true };
}

export async function setDailyBudget(workspaceId: string, uid: string, campaignId: string, dailyBudgetMinor: number) {
    if (!Number.isInteger(dailyBudgetMinor) || dailyBudgetMinor < 100 || dailyBudgetMinor > 100_000_000) {
        throw new AdsError('Enter a daily budget between 1 and 1,000,000.');
    }
    const { adAccountId, token } = await getAdsConnection(workspaceId);
    const campaign = await ownCampaign(adAccountId, token, campaignId);
    if (!campaign.daily_budget) {
        throw new AdsError('This campaign has no campaign daily budget (its ad sets hold the budget). Change it in Meta Ads Manager.', 409);
    }
    await graphPost(campaignId, { daily_budget: String(dailyBudgetMinor), access_token: token });
    await logActivity(workspaceId, { uid, action: 'daily_budget', campaignId, campaignName: campaign.name, from: Number(campaign.daily_budget), to: dailyBudgetMinor });
    return { changed: true };
}

export async function recentActivity(workspaceId: string) {
    const snap = await wsRef(workspaceId).collection('adsActivity').orderBy('at', 'desc').limit(20).get();
    return snap.docs.map((d) => {
        const a = d.data();
        return { id: d.id, ...a, at: a.at?.toMillis?.() ?? null };
    });
}

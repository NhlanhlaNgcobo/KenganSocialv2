export interface LeadSignal {
    lastEngagedAt?: Date | string | number | any; // Any valid date structure for Firestore
    totalLikes: number;
    totalComments: number;
    dmOpened: boolean;
    dmReplied: boolean;
    linkClicked: boolean;
    bookingMade: boolean;
    storyReply: boolean;
}

export interface Lead {
    id?: string;
    username: string;
    platform: string;
    displayName?: string;
    avatarUrl?: string;
    followersCount: number;
    bio?: string;
    email?: string;
    company?: string;
    website?: string;
    industryMatch: boolean;
    hasPreviousCollab: boolean;
    score: number;
    tier: 'hot' | 'warm' | 'cold' | 'prospect';
    signals: LeadSignal;
    notes?: string;
    status: 'prospect' | 'contacted' | 'negotiating' | 'closed' | 'lost';
    tags: string[];
    createdAt?: Date;
    updatedAt?: Date;
}

function daysSince(dateInput: any): number {
    if (!dateInput) return Infinity;
    // Handle Firestore Timestamp or ISO string or Date object
    let date: Date;
    if (typeof dateInput?.toDate === 'function') {
        date = dateInput.toDate();
    } else {
        date = new Date(dateInput);
    }
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getFollowerFit(followersCount: number): number {
    if (followersCount > 100000) return 10;
    if (followersCount > 10000) return 5;
    return 0;
}

export function calculateScore(lead: Partial<Lead>, workspaceNiche?: string): number {
    let score = 0;

    // Profile match (0-30 pts)
    if (lead.industryMatch) score += 10;
    score += getFollowerFit(lead.followersCount || 0);
    if (lead.hasPreviousCollab) score += 10;

    // Engagement signals (0-30 pts)
    const sig = lead.signals || {} as LeadSignal;
    if (sig.totalLikes && sig.totalLikes >= 3) score += 10;
    if (sig.totalComments) score += 8;
    if (sig.storyReply) score += 7;
    if (sig.linkClicked) score += 5;

    // Communication (0-20 pts)
    if (sig.dmOpened) score += 10;
    if (sig.dmReplied) score += 8;
    if (sig.bookingMade) {
        score = Math.min(score + 15, score + 20); // Add points realistically
    }

    // Recency (0-20 pts)
    const days = daysSince(sig.lastEngagedAt);
    if (days <= 7) score += 20;
    else if (days <= 30) score += 10;
    else if (days <= 90) score += 5;

    return Math.min(score, 100);
}

export function determineTier(score: number): 'hot' | 'warm' | 'cold' | 'prospect' {
    if (score >= 70) return 'hot';
    if (score >= 40) return 'warm';
    if (score >= 10) return 'cold';
    return 'prospect';
}

export function processLeadScore(lead: Partial<Lead>, workspaceNiche?: string): Partial<Lead> {
    const score = calculateScore(lead, workspaceNiche);
    const tier = determineTier(score);
    return { ...lead, score, tier };
}

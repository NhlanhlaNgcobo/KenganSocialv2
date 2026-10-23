import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    appendActivity,
    assetSummary,
    auditTrail,
    decisionConflict,
    editsApprovedContent,
    hashIp,
    publicApproval,
    publicComment,
    reviewAfterDelete,
    reviewNotification,
    visibleToClient,
} from '../../src/services/agency/review.js';

const approvedAsset = {
    title: 'Launch reel',
    status: 'approved',
    currentVersion: 2,
    caption: 'Hello',
    platforms: ['instagram'],
    clientId: 'c1',
    approval: { status: 'approved', version: 2, by: 'Thandi', email: 'thandi@client.co.za', at: '2026-10-01T10:00:00.000Z', note: '', audit: { ipHash: 'abc', userAgent: 'Mobile Safari' } },
};

test('the public review page never sees reviewer emails or the audit trail', () => {
    const forClient = publicApproval(approvedAsset.approval);
    assert.deepEqual(Object.keys(forClient).sort(), ['at', 'by', 'note', 'status', 'version']);
    const text = JSON.stringify(forClient);
    assert.equal(text.includes('thandi@client.co.za'), false);
    assert.equal(text.includes('abc'), false);
    assert.equal(text.includes('Safari'), false);
    assert.equal(publicApproval(null), null);
    assert.equal(publicApproval({}), null);

    // The agency sees who approved (email) but not the audit fields.
    const forTeam = assetSummary('a1', approvedAsset).approval;
    assert.equal(forTeam.email, 'thandi@client.co.za');
    assert.equal('audit' in forTeam, false);

    const comment = publicComment('x', { text: 'Nice', author: { kind: 'client', name: 'Thandi', email: 'thandi@client.co.za' }, audit: { ipHash: 'abc' }, internal: false }, { forClient: true });
    assert.equal(JSON.stringify(comment).includes('thandi@client.co.za'), false);
    assert.equal('audit' in comment, false);
    assert.equal('internal' in comment, false);
});

test('internal team notes are filtered from the client view', () => {
    const comments = [{ text: 'For the client' }, { text: 'Team only', internal: true }, { text: 'Legacy, no flag', internal: undefined }];
    assert.deepEqual(comments.filter(visibleToClient).map((c) => c.text), ['For the client', 'Legacy, no flag']);
    assert.equal(publicComment('y', { text: 'Team only', internal: true, author: { kind: 'team', name: 'Sipho' } }).internal, true);
});

test('a decision must be on the version the client was viewing', () => {
    const asset = { status: 'in_review', currentVersion: 3, approval: null };
    assert.equal(decisionConflict(asset, 'approved', 3), null);
    assert.equal(decisionConflict(asset, 'approved', '3'), null);
    const stale = decisionConflict(asset, 'approved', 2);
    assert.equal(stale.status, 409);
    assert.match(stale.message, /newer version/i);
    for (const missing of [undefined, null, '', 'abc', 0, -1, 2.5]) assert.equal(decisionConflict(asset, 'approved', missing).status, 400);
});

test('an approval is locked until the agency reopens it; a change request is not', () => {
    assert.equal(decisionConflict(approvedAsset, 'changes_requested', 2).status, 409);
    assert.equal(decisionConflict(approvedAsset, 'approved', 2).status, 409);
    const changes = { status: 'changes_requested', currentVersion: 2, approval: { status: 'changes_requested', version: 2 } };
    assert.equal(decisionConflict(changes, 'approved', 2), null);
    assert.equal(decisionConflict(changes, 'changes_requested', 2), null);
    // Reopened by the agency (status back to in review, approval cleared): the client may decide again.
    assert.equal(decisionConflict({ ...approvedAsset, status: 'in_review', approval: null }, 'changes_requested', 2), null);
    // Taken back to draft by the team: nothing to decide on.
    assert.equal(decisionConflict({ status: 'draft', currentVersion: 1 }, 'approved', 1).status, 409);
});

test('editing approved content reopens it; title and post date do not', () => {
    assert.equal(editsApprovedContent(approvedAsset, { caption: 'Changed' }), true);
    assert.equal(editsApprovedContent(approvedAsset, { platforms: ['instagram', 'tiktok'] }), true);
    assert.equal(editsApprovedContent(approvedAsset, { clientId: 'c2' }), true);
    assert.equal(editsApprovedContent(approvedAsset, { caption: 'Hello', platforms: ['instagram'], clientId: 'c1' }), false);
    assert.equal(editsApprovedContent(approvedAsset, { title: 'New name', dueDate: '2026-11-01' }), false);
    // Missing fields compare as their defaults, so saving an unchanged empty caption is not an edit.
    assert.equal(editsApprovedContent({ status: 'approved' }, { caption: '', platforms: [], clientId: null }), false);
});

test('reviewer IPs are stored only as a keyed hash', () => {
    const key = 'a'.repeat(64);
    const expected = crypto.createHmac('sha256', key).update('203.0.113.9').digest('hex');
    assert.equal(hashIp('203.0.113.9', key), expected);
    assert.notEqual(hashIp('203.0.113.9', key), hashIp('203.0.113.9', 'b'.repeat(64)));
    assert.equal(hashIp('203.0.113.9', ''), crypto.createHash('sha256').update('203.0.113.9').digest('hex'));
    const trail = auditTrail('203.0.113.9', 'Mozilla/5.0\u0000' + 'x'.repeat(500), key);
    assert.equal(trail.ipHash.includes('203.0.113.9'), false);
    assert.equal(trail.userAgent.length, 300);
    assert.equal(trail.userAgent.includes('\u0000'), false);
    assert.equal(auditTrail(undefined, undefined, key).userAgent, null);
});

test('the activity log is capped at 50 entries and keeps the newest', () => {
    const list = Array.from({ length: 60 }, (_, i) => ({ n: i }));
    const next = appendActivity(list, { n: 'new' });
    assert.equal(next.length, 50);
    assert.equal(next[49].n, 'new');
    assert.equal(next[0].n, 11);
    assert.deepEqual(appendActivity(undefined, { n: 1 }), [{ n: 1 }]);
    assert.equal(list.length, 60, 'input is not mutated');
});

test('client actions notify the agency workspace with a link to the video', () => {
    const n = reviewNotification({ workspaceId: 'ws1', kind: 'changes_requested', assetId: 'a/1', assetTitle: 'Launch reel', clientId: 'c1', by: 'Thandi', version: 2, text: 'Use the new logo' });
    assert.equal(n.workspaceId, 'ws1');
    assert.equal(n.source, 'review');
    assert.equal(n.type, 'warning');
    assert.equal(n.read, false);
    assert.equal(n.assetId, 'a/1');
    assert.equal(n.link, '/dashboard/clients?asset=a%2F1');
    assert.match(n.title, /Thandi asked for changes/);
    assert.match(n.message, /new logo/);
    assert.equal(reviewNotification({ workspaceId: 'ws1', kind: 'approved', assetId: 'a', by: '', version: 1 }).type, 'success');
    assert.match(reviewNotification({ workspaceId: 'ws1', kind: 'comment', assetId: 'a', by: 'T', version: 1, text: 'x'.repeat(1000) }).message, /^Version 1: x{160}$/);
});

test('deleting a video drops it from links and switches off emptied links', () => {
    assert.deepEqual(reviewAfterDelete(['a', 'b'], 'a'), { remaining: ['b'], revoke: false });
    assert.deepEqual(reviewAfterDelete(['a'], 'a'), { remaining: [], revoke: true });
    assert.deepEqual(reviewAfterDelete(undefined, 'a'), { remaining: [], revoke: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, sanitizeLeadUpdate } from '../../src/services/leads/sanitize';

test('lead edits keep only known fields with valid types', () => {
    const { value } = sanitizeLeadUpdate({ status: 'contacted', notes: ' hi ', score: 100, tier: 'hot', externalId: 'x', followersCount: '1200.7' });
    assert.deepEqual(value, { status: 'contacted', notes: 'hi', followersCount: 1200 });
    assert.ok(sanitizeLeadUpdate({ status: 'vip' }).error);
    assert.ok(sanitizeLeadUpdate({ followersCount: -5 }).error);
    assert.ok(sanitizeLeadUpdate({ username: '@@' }).error);
    assert.ok(sanitizeLeadUpdate({ platform: 'myspace' }).error);
    assert.ok(sanitizeLeadUpdate([]).error);
    assert.deepEqual(sanitizeLeadUpdate({ signals: { totalLikes: '3', dmReplied: 'yes', injected: { a: 1 } } }).value, { signals: { totalLikes: 3, dmReplied: false } });
    assert.ok(sanitizeLeadUpdate({ signals: 'lots' }).error);
});

test('CSV cells cannot run as spreadsheet formulas', () => {
    assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(csvCell('+27 82'), "'+27 82");
    assert.equal(csvCell('@handle'), "'@handle");
    assert.equal(csvCell('-1'), "'-1");
    assert.equal(csvCell('plain name'), 'plain name');
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(42), '42');
});

import { redis } from '../../utils/redis';
import { PLAN_LIMITS } from '../../utils/planLimits';
import { getMonth, endOfMonth } from '../../utils/dateUtils';
import { problem } from './validation.js';

// The reservation ledger and existing monthly render counter change atomically.
const RESERVE = `
if redis.call('GET', KEYS[2]) == 'charged' then return 1 end
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local cap = tonumber(ARGV[1])
if cap == 0 or (cap > 0 and used >= cap) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], 'charged', 'EXAT', ARGV[2])
return 1`;
const REFUND = `
if redis.call('GET', KEYS[2]) ~= 'charged' then return 0 end
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used > 0 then redis.call('DECR', KEYS[1]) end
redis.call('SET', KEYS[2], 'refunded', 'KEEPTTL')
return 1`;
export function billingContext(workspaceId: string, id: string, plan: string) {
    return { counter: `usage:${workspaceId}:renders:${getMonth()}`, ledger: `video-ad-usage:${id}`, expires: endOfMonth(), limit: (PLAN_LIMITS as any)[plan]?.renders ?? 0 };
}
async function ready() {
    if (redis.status === 'ready') return;
    // 'end': the dev client gave up after Redis was unreachable once; try again rather than failing every render.
    if (redis.status === 'wait' || redis.status === 'end') void redis.connect().catch(() => {});
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { redis.off('ready', onReady); reject(problem(503, 'Render allowances are temporarily unavailable. Try again later.')); }, 5000);
        function onReady() { clearTimeout(timer); resolve(); }
        redis.once('ready', onReady);
    });
}
export async function reserve(billing: ReturnType<typeof billingContext>) {
    await ready();
    const allowed = await redis.eval(RESERVE, 2, billing.counter, billing.ledger, billing.limit, billing.expires);
    if (Number(allowed) !== 1) throw problem(402, 'Your plan has no remaining video renders. Check Billing for your allowance.');
}
export async function refund(billing: ReturnType<typeof billingContext>) {
    await ready();
    await redis.eval(REFUND, 2, billing.counter, billing.ledger);
}

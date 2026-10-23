export const RESERVE_USAGE = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if limit >= 0 and current + amount > limit then return {0, current} end
redis.call('INCRBY', KEYS[1], amount)
redis.call('EXPIREAT', KEYS[1], ARGV[3])
return {1, current}
`;
export const REFUND_USAGE = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local refund = math.min(current, tonumber(ARGV[1]))
if refund > 0 then redis.call('DECRBY', KEYS[1], refund) end
return current - refund
`;

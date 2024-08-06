const crypto = require('crypto');
const redis = require('./redisClient');

const LOCK_TTL_MS = 5000;

// Delete the key only if it still holds our token, so an expired lock that
// someone else has since taken is never released by mistake.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

// SET key token NX PX ttl. Resolves to the token when the lock is ours, or
// null when another request holds it. Throws if Redis is unreachable; the
// caller decides what to do (the booking route fails closed with a 503).
exports.acquireLock = async (key) => {
  const token = crypto.randomUUID();
  const result = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
  return result === 'OK' ? token : null;
};

exports.releaseLock = async (key, token) => {
  try {
    await redis.eval(RELEASE_SCRIPT, 1, key, token);
  } catch (err) {
    // The TTL will expire the lock on its own.
    console.error('Failed to release booking lock:', err.message);
  }
};

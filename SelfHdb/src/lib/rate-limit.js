class MemoryRateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  consume(bucketName, key, { max, windowMs }) {
    const now = Date.now();
    const bucketKey = `${bucketName}:${key}`;
    const bucket = this.buckets.get(bucketKey) || [];
    const nextBucket = bucket.filter((timestamp) => now - timestamp < windowMs);

    if (nextBucket.length >= max) {
      const retryAfterMs = windowMs - (now - nextBucket[0]);
      return {
        allowed: false,
        retryAfterMs,
      };
    }

    nextBucket.push(now);
    this.buckets.set(bucketKey, nextBucket);

    return {
      allowed: true,
      remaining: Math.max(0, max - nextBucket.length),
    };
  }
}

function createRateLimitGuard(rateLimiter, bucketName, options, keyBuilder) {
  return async function rateLimitGuard(request, reply) {
    const key = keyBuilder(request);
    const result = rateLimiter.consume(bucketName, key, options);
    if (!result.allowed) {
      reply.header('Retry-After', Math.ceil(result.retryAfterMs / 1000));
      reply.code(429).send({
        error: 'rate_limited',
        message: 'Too many requests. Please try again later.',
      });
      return reply;
    }

    return undefined;
  };
}

module.exports = {
  MemoryRateLimiter,
  createRateLimitGuard,
};

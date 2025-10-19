export class TokenBucket {
  constructor({ ratePerSecond, burst }) {
    this.rate = ratePerSecond;
    this.capacity = burst;
    this.buckets = new Map();
  }

  _refill(bucket, now) {
    const elapsed = (now - bucket.updatedAt) / 1000;
    if (elapsed <= 0) return bucket;
    const tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.rate);
    return { tokens, updatedAt: now };
  }

  take(key) {
    const now = Date.now();
    const bucket = this.buckets.get(key) || { tokens: this.capacity, updatedAt: now };
    const refilled = this._refill(bucket, now);
    if (refilled.tokens < 1) {
      this.buckets.set(key, refilled);
      return false;
    }
    refilled.tokens -= 1;
    this.buckets.set(key, refilled);
    return true;
  }
}

export function createLimiter({ ratePerSecond, burst, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const bucket = hits.get(key) || { count: 0, reset: now + windowMs };
    if (now > bucket.reset) {
      bucket.count = 0;
      bucket.reset = now + windowMs;
    }
    if (bucket.count >= burst) {
      hits.set(key, bucket);
      return false;
    }
    bucket.count += 1;
    hits.set(key, bucket);
    return true;
  };
}

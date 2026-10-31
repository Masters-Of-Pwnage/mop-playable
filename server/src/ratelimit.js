/** Token bucket rate limiter. */
export class Bucket {
  constructor(perSecond, burst) {
    this.rate = perSecond;
    this.burst = burst;
    this.tokens = burst;
    this.last = Date.now();
  }

  take(cost = 1) {
    this.refill();
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  refill() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
  }
}

/** One bucket per key (client address). Full buckets are dropped by sweep() so the map stays small. */
export class KeyedLimiter {
  constructor(perSecond, burst) {
    this.perSecond = perSecond;
    this.burst = burst;
    this.buckets = new Map();
  }

  take(key, cost = 1) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Bucket(this.perSecond, this.burst);
      this.buckets.set(key, bucket);
    }
    return bucket.take(cost);
  }

  sweep() {
    for (const [key, bucket] of this.buckets) {
      bucket.refill();
      if (bucket.tokens >= bucket.burst) this.buckets.delete(key);
    }
  }
}

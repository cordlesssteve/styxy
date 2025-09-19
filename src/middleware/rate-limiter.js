/**
 * Rate Limiting Middleware
 *
 * Provides rate limiting to prevent API abuse and DoS attacks.
 * Uses in-memory store suitable for single-instance deployments.
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000; // 1 minute window
    this.maxRequests = options.maxRequests || 100; // Max requests per window
    this.skipPaths = options.skipPaths || ['/status']; // Paths to skip
    this.requests = new Map(); // IP -> { count, resetTime }

    // Cleanup old entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Express middleware function
   */
  limit() {
    return (req, res, next) => {
      // Skip rate limiting for certain paths
      if (this.skipPaths.includes(req.path)) {
        return next();
      }

      const clientIp = this.getClientIp(req);
      const now = Date.now();
      const resetTime = now + this.windowMs;

      // Get or initialize client record
      let clientRecord = this.requests.get(clientIp);
      if (!clientRecord || now > clientRecord.resetTime) {
        clientRecord = {
          count: 0,
          resetTime: resetTime
        };
      }

      // Increment request count
      clientRecord.count++;
      this.requests.set(clientIp, clientRecord);

      // Check if rate limit exceeded
      if (clientRecord.count > this.maxRequests) {
        const retryAfter = Math.ceil((clientRecord.resetTime - now) / 1000);

        res.set({
          'X-RateLimit-Limit': this.maxRequests,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': new Date(clientRecord.resetTime).toISOString(),
          'Retry-After': retryAfter
        });

        return res.status(429).json({
          success: false,
          error: 'Too many requests. Please try again later.',
          retryAfter: retryAfter
        });
      }

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': this.maxRequests,
        'X-RateLimit-Remaining': Math.max(0, this.maxRequests - clientRecord.count),
        'X-RateLimit-Reset': new Date(clientRecord.resetTime).toISOString()
      });

      next();
    };
  }

  /**
   * Get client IP address from request
   */
  getClientIp(req) {
    // For local development, use 'localhost' as identifier
    // In production, you might want to use actual IP
    return req.ip || req.connection.remoteAddress || '127.0.0.1';
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [ip, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(ip);
      }
    }
  }

  /**
   * Get current rate limit stats
   */
  getStats() {
    return {
      activeClients: this.requests.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests
    };
  }

  /**
   * Reset rate limits for a specific IP (admin function)
   */
  resetClient(clientIp) {
    this.requests.delete(clientIp);
  }

  /**
   * Reset all rate limits (admin function)
   */
  resetAll() {
    this.requests.clear();
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.requests.clear();
  }
}

module.exports = RateLimiter;
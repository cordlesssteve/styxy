/**
 * Authentication Middleware
 *
 * Provides token-based authentication for Styxy daemon API endpoints.
 * Uses simple API key authentication suitable for local development.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class AuthMiddleware {
  constructor(configDir) {
    this.configDir = configDir;
    this.tokenFile = path.join(configDir, 'auth.token');
    this.apiKey = this.loadOrCreateApiKey();
  }

  /**
   * Load existing API key or create a new one
   */
  loadOrCreateApiKey() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        const token = fs.readFileSync(this.tokenFile, 'utf8').trim();
        if (token && token.length >= 32) {
          console.log('✅ Loaded existing API key for authentication');
          return token;
        }
      }

      // Create new API key
      const newToken = crypto.randomBytes(32).toString('hex');

      // Ensure config directory exists
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
      }

      // Write token with secure permissions
      fs.writeFileSync(this.tokenFile, newToken, { mode: 0o600 });
      console.log('✅ Generated new API key for authentication');
      console.log(`🔑 API Key: ${newToken}`);
      console.log('📁 Saved to:', this.tokenFile);

      return newToken;
    } catch (error) {
      console.error('Failed to load/create API key:', error.message);
      throw new Error('Authentication setup failed');
    }
  }

  /**
   * Express middleware function
   */
  authenticate() {
    return (req, res, next) => {
      // Skip auth for status endpoint (health checks)
      if (req.path === '/status') {
        return next();
      }

      // Skip auth in test environment if specified
      if (process.env.NODE_ENV === 'test' && process.env.STYXY_SKIP_AUTH === 'true') {
        return next();
      }

      const authHeader = req.headers.authorization;
      const apiKeyHeader = req.headers['x-api-key'];

      let providedKey = null;

      // Support both Authorization header and X-API-Key header
      if (authHeader && authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.substring(7);
      } else if (apiKeyHeader) {
        providedKey = apiKeyHeader;
      }

      if (!providedKey) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required. Provide API key via Authorization: Bearer <key> or X-API-Key: <key> header'
        });
      }

      // Constant-time comparison to prevent timing attacks
      if (!this.constantTimeCompare(providedKey, this.apiKey)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key'
        });
      }

      // Authentication successful
      next();
    };
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  constantTimeCompare(a, b) {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Get the current API key (for display purposes)
   */
  getApiKey() {
    return this.apiKey;
  }

  /**
   * Regenerate API key
   */
  regenerateApiKey() {
    const newToken = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(this.tokenFile, newToken, { mode: 0o600 });
    this.apiKey = newToken;

    console.log('✅ Regenerated API key');
    console.log(`🔑 New API Key: ${newToken}`);

    return newToken;
  }
}

module.exports = AuthMiddleware;
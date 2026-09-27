/**
 * Require authenticated session.
 * Attaches req.user with safe user fields (no passwordHash).
 */
export function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  next();
}

/**
 * Optional auth - continues even if not logged in.
 */
export function optionalAuth(req, res, next) {
  next();
}

/**
 * Attach user object from session to req.user if present.
 */
export function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    req.user = {
      id: req.session.userId,
      username: req.session.username,
      displayName: req.session.displayName,
      email: req.session.email,
      avatarUrl: req.session.avatarUrl || null,
    };
  }
  next();
}

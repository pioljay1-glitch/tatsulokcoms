import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../utils/db.js';
import { hashPassword, verifyPassword, validatePassword } from '../utils/password.js';
import { isValidEmail, isValidUsername, isValidDisplayName, sanitizeString } from '../utils/validation.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Rate limit auth endpoints to reduce brute-force risk
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { error: 'Too many attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl || null,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function setSessionUser(req, user) {
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.displayName = user.displayName;
  req.session.email = user.email;
  req.session.avatarUrl = user.avatarUrl || null;
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { displayName, username, email, password, confirmPassword } = req.body || {};

    // Validate display name
    if (!isValidDisplayName(displayName)) {
      return res.status(400).json({ error: 'Display name is required (1-64 characters).' });
    }

    // Validate username
    if (!isValidUsername(username)) {
      return res.status(400).json({
        error: 'Username must be 3-32 characters, start with a letter or number, and contain only letters, numbers, and underscores.',
      });
    }

    // Validate email
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    // Validate password
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.message });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();
    const cleanDisplayName = sanitizeString(displayName, 64);

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { username: cleanUsername },
          { email: cleanEmail },
        ],
      },
    });

    if (existing) {
      if (existing.username === cleanUsername) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        displayName: cleanDisplayName,
        email: cleanEmail,
        passwordHash,
        status: 'online',
        lastLoginAt: new Date(),
      },
    });

    setSessionUser(req, user);

    // Save session explicitly
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return res.status(201).json({ user: safeUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    // Handle unique constraint race
    if (err.code === 'P2002') {
      const target = err.meta?.target || [];
      if (target.includes('username')) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      if (target.includes('email')) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
    }
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/username and password are required.' });
    }

    const cleanId = String(identifier).trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: cleanId },
          { username: cleanId },
        ],
      },
    });

    // Generic error – do not reveal whether account exists
    if (!user) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    const match = await verifyPassword(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    // Update last login
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), status: 'online' },
    });

    setSessionUser(req, updated);

    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return res.json({ user: safeUser(updated) });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // Mark offline only if no other active sessions (simplified: always set offline on logout)
    // Multi-device presence is handled by Socket.IO presence tracking
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { status: 'offline' },
      }).catch(() => {});
    }

    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
        return res.status(500).json({ error: 'Logout failed.' });
      }
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      });
      return res.json({ ok: true });
    });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ error: 'Logout failed.' });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
    });

    if (!user) {
      // Session points to deleted user
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    // Refresh session data
    setSessionUser(req, user);

    return res.json({ user: safeUser(user) });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// PATCH /api/auth/profile
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { displayName, username, avatarUrl } = req.body || {};
    const userId = req.session.userId;

    const data = {};

    if (displayName !== undefined) {
      if (!isValidDisplayName(displayName)) {
        return res.status(400).json({ error: 'Display name must be 1-64 characters.' });
      }
      data.displayName = sanitizeString(displayName, 64);
    }

    if (username !== undefined) {
      if (!isValidUsername(username)) {
        return res.status(400).json({
          error: 'Username must be 3-32 characters, start with a letter or number, and contain only letters, numbers, and underscores.',
        });
      }
      const cleanUsername = username.trim().toLowerCase();
      const existing = await prisma.user.findFirst({
        where: { username: cleanUsername, NOT: { id: userId } },
      });
      if (existing) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      data.username = cleanUsername;
    }

    if (avatarUrl !== undefined) {
      // Allow null to clear, or a URL string (validated lightly)
      if (avatarUrl === null || avatarUrl === '') {
        data.avatarUrl = null;
      } else if (typeof avatarUrl === 'string' && avatarUrl.length <= 2048) {
        data.avatarUrl = avatarUrl;
      } else {
        return res.status(400).json({ error: 'Invalid avatar URL.' });
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });

    setSessionUser(req, user);

    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return res.json({ user: safeUser(user) });
  } catch (err) {
    console.error('Profile update error:', err);
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Username is already taken.' });
    }
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const userId = req.session.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.message });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    const match = await verifyPassword(currentPassword, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return res.json({ ok: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to change password.' });
  }
});

export default router;

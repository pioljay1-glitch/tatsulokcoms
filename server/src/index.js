import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import authRoutes from './routes/auth.js';
import { attachUser } from './middleware/auth.js';
import { setupSocket } from './socket/index.js';
import prisma from './utils/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Using a temporary secret (not for production).');
}
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// Security headers
app.use(helmet({
  contentSecurityPolicy: isProd ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

// CORS – credentials required for session cookies
const clientUrl = process.env.CLIENT_URL || (isProd ? false : 'http://localhost:5173');
app.use(cors({
  origin: clientUrl || true,
  credentials: true,
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// PostgreSQL session store
const PgSession = connectPgSimple(session);
const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false,
});

const sessionMiddleware = session({
  store: new PgSession({
    pool: pgPool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid',
  cookie: {
    httpOnly: true,
    secure: isProd, // HTTPS only in production
    sameSite: isProd ? 'none' : 'lax', // none required for cross-site on Render if frontend is separate; same origin is fine
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});

app.use(sessionMiddleware);
app.use(attachUser);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Auth routes
app.use('/api/auth', authRoutes);

// Seed default channels on startup
async function seedChannels() {
  const defaults = [
    { name: 'general', type: 'text', description: 'General chat' },
    { name: 'random', type: 'text', description: 'Random topics' },
    { name: 'Lobby', type: 'voice', description: 'Main voice lobby' },
    { name: 'Gaming', type: 'voice', description: 'Gaming voice channel' },
  ];
  for (const ch of defaults) {
    await prisma.channel.upsert({
      where: { name: ch.name },
      update: {},
      create: ch,
    }).catch(() => {});
  }
}

// Serve React build in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// SPA fallback – protect main app routes by letting frontend handle redirects
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket')) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) {
      // Dev mode – client runs on Vite
      res.status(200).send('TATSULOKComs API is running. Start the client with npm run dev:client');
    }
  });
});

// Socket.IO with shared session
setupSocket(server, sessionMiddleware);

async function start() {
  try {
    // Verify DB connection
    await prisma.$connect();
    console.log('Connected to PostgreSQL');
    await seedChannels();
    console.log('Channels seeded');

    server.listen(PORT, () => {
      console.log(`TATSULOKComs server listening on port ${PORT} (${isProd ? 'production' : 'development'})`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down…');
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});

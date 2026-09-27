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

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https://www.youtube.com", "https://www.youtube.com/iframe_api", "https://s.ytimg.com", "https://www.google.com"],
      "frame-src": ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
      "child-src": ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com", "blob:"],
      "img-src": ["'self'", "data:", "blob:", "https://i.ytimg.com", "https://*.ytimg.com", "https:"],
      "media-src": ["'self'", "blob:", "mediastream:", "https:"],
      "connect-src": ["'self'", "wss:", "ws:", "https:", "https://www.youtube.com"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "font-src": ["'self'", "data:"],
      "worker-src": ["'self'", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

const clientUrl = process.env.CLIENT_URL || (isProd ? false : 'http://localhost:5173');
app.use(cors({
  origin: clientUrl || true,
  credentials: true,
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

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
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  },
});

app.use(sessionMiddleware);
app.use(attachUser);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);

async function seedChannels() {
  const defaults = [
    { name: 'general', type: 'text', description: 'General chat' },
    { name: 'random', type: 'text', description: 'Random topics' },
    { name: 'ChatAssistant', type: 'text', description: 'Speaking AI assistant' },
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

const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket')) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('TATSULOKComs API is running. Start the client with npm run dev:client');
    }
  });
});

setupSocket(server, sessionMiddleware);

async function start() {
  try {
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

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down…');
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});

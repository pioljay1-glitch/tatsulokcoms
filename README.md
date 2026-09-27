# TATSULOKComs

Real-time communication platform with **persistent user accounts**, PostgreSQL authentication, Socket.IO chat, and WebRTC voice.

## Features (Auth System)

- **Register / Login / Logout** with real database accounts
- **HTTP-only secure session cookies** (not localStorage)
- **bcrypt password hashing** (never stores plaintext)
- Username, display name, email, avatar, profile settings
- Password change with current-password verification
- Session persistence across browser restarts
- Multi-device support (user stays online while any session is active)
- Protected routes + protected API endpoints
- Socket.IO identity taken from authenticated session (no client spoofing)

## Architecture

```
GitHub → Render Web Service (Node + Express + React)
              ↓
       Render PostgreSQL (users, sessions, messages)
```

## Tech Stack

| Layer        | Technology                          |
|-------------|--------------------------------------|
| Frontend    | React + Vite + React Router         |
| Backend     | Node.js + Express                   |
| Database    | PostgreSQL + Prisma ORM             |
| Sessions    | express-session + connect-pg-simple |
| Auth        | bcrypt + HTTP-only cookies          |
| Real-time   | Socket.IO                           |
| Voice       | WebRTC signaling via Socket.IO      |

## Quick Start (Local)

### 1. Prerequisites

- Node.js 18+
- PostgreSQL database (local or cloud)

### 2. Clone & Install

```bash
git clone https://github.com/pioljay1-glitch/tatsulokcoms.git
cd tatsulokcoms
npm install
```

### 3. Environment

Copy the example env file:

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
SESSION_SECRET=your-long-random-secret
CLIENT_URL=http://localhost:5173
```

### 4. Database Setup

```bash
npm run db:generate
npm run db:push
# or for migrations:
npm run db:migrate:dev
```

### 5. Run

```bash
npm run dev
```

- Frontend: http://localhost:5173  
- Backend API: http://localhost:3000  

## Deploy on Render

1. Create a **PostgreSQL** database on Render. Copy the **Internal Database URL**.
2. Create a **Web Service** connected to this GitHub repo.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Environment variables:

| Variable         | Value                                      |
|------------------|--------------------------------------------|
| `NODE_ENV`       | `production`                               |
| `DATABASE_URL`   | (from Render PostgreSQL)                   |
| `SESSION_SECRET` | long random string                         |
| `CLIENT_URL`     | your Render service URL (or leave blank)   |

6. After first deploy, run migrations if needed:

```bash
npm run db:migrate
```

(Or use `prisma db push` during initial setup.)

Accounts survive server restarts because they live in PostgreSQL.

## Auth API

| Method | Endpoint                    | Description                |
|--------|-----------------------------|----------------------------|
| POST   | `/api/auth/register`        | Create account + session   |
| POST   | `/api/auth/login`           | Login + session            |
| POST   | `/api/auth/logout`          | Destroy session            |
| GET    | `/api/auth/me`              | Current user               |
| PATCH  | `/api/auth/profile`         | Update display name / username / avatar |
| POST   | `/api/auth/change-password` | Change password            |

## Security Notes

- Passwords hashed with bcrypt (12 rounds)
- Sessions stored in PostgreSQL, cookie is HTTP-only + Secure in production
- Rate limiting on register/login
- Generic login errors (no account enumeration)
- Socket.IO user identity comes from session, never from client-supplied username
- Input validation on both client and server

## License

MIT

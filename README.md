# GokkeHub

A party game platform with personalised experiences powered by players' Steam, Spotify, and Discord accounts.

---

## Getting started

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/gokkehub.git
cd gokkehub

# 2. Copy the environment template and fill in your values
cp .env.example .env.local
# Edit .env.local — see comments in the file for where to get each value

# 3. Install all dependencies (installs across all workspaces)
npm install

# 4. Start the development server
npm run dev
```

---

## Project structure

```
gokkehub/
├── apps/
│   ├── web/             → gokkehub.com          — Landing page
│   ├── account/         → account.gokkehub.com  — Auth, profiles, linked accounts
│   ├── gridchallenge/   → partybingo.gokkehub.com — Team bingo with custom challenges
│   ├── trackguess/      → musicquiz.gokkehub.com — Spotify-powered music quiz
│   ├── timelinedrop/    → hitster.gokkehub.com   — Song timeline ordering game
│   └── beatrank/        → bezzerwizzer.gokkehub.com — Music trivia battle
├── packages/
│   ├── ui/              → Shared React components (buttons, cards, modals)
│   ├── auth/            → Shared Supabase auth helpers
│   ├── db/              → Shared D1/Supabase client and TypeScript types
│   └── config/          → Shared Tailwind and TypeScript base config
├── .env.example         → Template for required environment variables
└── turbo.json           → Turborepo pipeline config
```

Each app is a React 18 + Vite + TypeScript app deployed to Cloudflare Pages. Backend logic lives in each app's `/functions/` folder (Cloudflare Pages Functions / Workers).

---

## Games

| Game | Subdomain | Description |
|------|-----------|-------------|
| Party Bingo | partybingo.gokkehub.com | Team-based bingo with custom challenges |
| Track Guess | musicquiz.gokkehub.com | Guess the song from a Spotify snippet |
| Timeline Drop | hitster.gokkehub.com | Order songs by release year |
| Beat Rank | bezzerwizzer.gokkehub.com | Music trivia battle |

---

## Security

`.env` files are listed in `.gitignore` and must **never** be committed to this repository. See [`.env.example`](./.env.example) for the full list of required environment variables and where to obtain each value.

Key rules enforced throughout the codebase:

- `SUPABASE_SERVICE_ROLE_KEY` is only ever used server-side in `/functions/` — never in client code
- All OAuth flows (Spotify, Discord, Steam) run server-side; the client only ever receives a session cookie
- Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to `.gokkehub.com`
- All D1 queries use parameterised statements — no string concatenation with user input
- Rate limiting is applied to all public endpoints

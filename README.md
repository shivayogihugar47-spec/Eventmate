# EventMate Live

A conversational AI event-planning assistant for weddings, birthdays, and community events.
Built with **Next.js 16 (App Router)**, **TypeScript**, **Tailwind CSS**, **Zustand**, **OpenRouter**, and **Neon (serverless Postgres)**.

The assistant is fronted by **Diya**, a mood-reactive mascot that celebrates, worries, and comments on the plan as it takes shape.

---

## Project Structure

```
eventmate-live/
├── app/
│   ├── api/
│   │   ├── chat/route.ts       # Core state machine: ASK → PLAN → RUN/RE-PLAN
│   │   ├── comment/route.ts    # Witty one-line mascot reactions per wizard step
│   │   ├── compare/route.ts    # Vendor quote comparison (Zod-validated LLM JSON)
│   │   ├── whatif/route.ts     # "What If" cost-impact analysis
│   │   └── health/route.ts     # End-to-end health check for all wired services
│   ├── page.tsx                # Main planner UI (client component)
│   ├── layout.tsx              # Root layout & metadata
│   ├── ClientProviders.tsx     # Mounts floating mascot, cursor sparks, Konami egg
│   └── globals.css
├── components/
│   └── diya/                   # Mascot component suite (see "Diya Mascot" below)
├── db/
│   └── schema.sql              # All table definitions
├── lib/
│   ├── api.ts                  # Typed client wrappers for the API routes
│   ├── auth.ts                 # Neon Auth (Managed Better Auth) config helpers
│   ├── db.ts                   # Neon sql client
│   ├── diyaStore.ts            # Zustand store for mascot mood/speech/settings
│   ├── functions.ts            # Neon Functions client helpers
│   ├── llm.ts                  # OpenRouter client + llmJson helper
│   ├── useLiveEvent.ts         # SWR polling hook (client-side)
│   └── stages/
│       ├── ask.ts              # Q&A gathering stage
│       ├── plan.ts             # Plan generation + budget normalization
│       ├── replan.ts           # Re-plan diff + commit
│       ├── cascade.ts          # Dependency cascade logic
│       └── run.ts              # Day-of execution stage
├── scripts/
│   └── migrate.ts              # DB migration runner
├── tests/
│   └── plan.test.ts            # Vitest unit tests for plan/re-plan logic
├── hello.ts                    # Neon Function: trivial liveness probe
└── neon.ts                     # Neon project config (auth, functions, branches)
```

## RUN architecture

RUN starts when an organizer locks a generated plan. The plan is saved as version 1, with prepared risks, task records, expiring owner links, and an append-only audit entry. Event-day changes do not regenerate the plan: they go through this pipeline:

```text
CHANGE -> INTAKE -> IMPACT ENGINE -> OPTION GENERATOR -> VERIFIER
       -> APPROVAL -> APPLY -> NOTIFY -> AUDIT
```

| Stage | AI or plain code? | Responsibility |
|---|---|---|
| Intake | AI (`llmJson`, Zod validated) | Converts a free-text update into one or more typed changes; asks one clarifying question when needed. Quick actions use plain code. |
| Prepared risks | AI (`llmJson`, Zod validated) | Creates five event-specific risks and structured contingency operations when the plan is locked. A matching contingency is offered before generating new options. |
| Impact | Plain TypeScript | Computes downstream effects, task timing, critical path/slack, budget deltas, and hard-constraint violations. |
| Options | AI (`llmJson`, Zod validated) | Proposes ranked structured operations and tradeoffs; it cannot edit the plan. |
| Verification | Plain TypeScript | Applies each proposal to a copy, reruns impact/constraint checks, and removes unsafe options. |
| Approval and apply | Plain TypeScript + database transaction | The organizer selects a verified option. Version checks reject stale approvals; an idempotency key protects retries. Applying creates a new plan snapshot and audit event. |
| Owner messages | AI (`llmJson`, Zod validated) | Drafts short task updates for organizers to copy or open in WhatsApp; messages are never auto-sent. |
| Scheduling and live state | Plain TypeScript + database | Computes Now/Next from task state and the clock; SWR refreshes the Command Center every three seconds. |
| Audit | Plain TypeScript + database | Stores append-only change, apply, notification, and template events for the timeline. |

Task owners use expiring, unguessable links scoped to their assigned tasks. Their Done and Delay actions use the same event versioning and verification rules. If the network drops, organizer updates are queued locally and retried after reconnecting.

## Vendor search links

The Vendors tab creates city- and category-specific search links for the web, Google Maps, Justdial, and WedMeGood. It requires no API key or account setup and does not fetch or republish third-party listings. Justdial and WedMeGood links use a site-filtered web search. Search results are external and are not verified by EventMate; confirm services, availability, and pricing directly with each business.

## Accounts and saved events

Email/password accounts use Neon Managed Auth. Sign in before starting a plan; each locked event is linked to the account that created it. **My saved events** lists that account's plans, and reopening an event loads its latest saved plan version. Event APIs verify either the organizer's existing bearer token or the signed-in account that owns the event. Legacy events created before account ownership was added are not automatically assigned to a user.

---

## Manual Setup Steps

### 1 — Create a Neon project

1. Go to [console.neon.tech](https://console.neon.tech) and sign in (free tier available).
2. Click **New Project**, give it a name (e.g., `eventmate-live`), and choose a region.
3. Copy the **Connection string** from the project dashboard.

### 2 — Get an OpenRouter API key

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) and sign in.
2. Create a new API key and copy it.
3. Note: OpenRouter no longer serves the free `:free` variants of these models — use the paid slugs below.

### 3 — Configure environment variables

Copy `.env.example` to `.env.local` and fill in your values:

```env
# OpenRouter (LLM)
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct
OPENROUTER_FALLBACK_MODEL=openai/gpt-4o-mini
OPENROUTER_VISION_MODEL=                       # optional, fill when needed

# Neon Postgres
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
DATABASE_URL_UNPOOLED=

# Neon branch context
NEON_BRANCH=

# Neon Auth (filled automatically by `neon deploy`)
NEON_AUTH_BASE_URL=
NEON_AUTH_JWKS_URL=

# Neon Functions (filled automatically by `neon deploy`)
NEON_FUNCTION_HELLO_BASE_URL=
```

> `.env.local` is git-ignored. Never commit real keys.

### 4 — Configure authentication

Managed Neon Auth is enabled for the production branch. Set `NEON_AUTH_COOKIE_SECRET` to a random secret of at least 32 characters in `.env.local` and in the app host's server environment. A local secret can be generated with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Email/password sign-up and sign-in use Neon Auth. Users can create and reopen their own saved events from **My saved events**. New event plans are associated with the signed-in account; legacy events without an owner remain unchanged.

### 5 — Run the database migration

```bash
npm run db:migrate
```

This reads `db/schema.sql` and creates all tables on your Neon database.
Safe to re-run – all tables use `CREATE TABLE IF NOT EXISTS`.

### 6 — Start the dev server

```bash
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

---

## Testing the Health Endpoint

With the dev server running, open a browser or use curl:

```bash
curl http://localhost:3000/api/health
```

It probes every wired service end-to-end: OpenRouter, Neon Postgres, Neon Auth (JWKS reachability), and the `hello` Neon Function.

### Expected response (all OK)

```json
{
  "openrouter": { "status": "ok" },
  "openrouter_model": "meta-llama/llama-3.3-70b-instruct:free",
  "database": { "status": "ok" },
  "neon_auth": { "status": "ok" },
  "neon_function_hello": { "status": "ok", "response": "Hello from Neon Functions" },
  "allOk": true
}
```

HTTP status `200`. If any service fails, its entry carries an `error` status with a `detail` message and the response is `503`.

---

## Architecture & Prompt Flow

### Core Architecture
- **State Machine:** The app transitions between `ASK`, `PLAN`, and `RUN/RE-PLAN` stages.
- **Data Persistence:** All event data, chat history, and plan versions are stored in Neon Postgres (`events`, `tasks`, `budget_items`, `expenses`, `messages`, `plan_versions`).
- **Mascot Store:** `useDiya` (Zustand) manages mascot moods, speech, and accessibility settings globally.

### Prompt Flow
1. **Extraction (ASK):** User input is passed to an LLM to extract event details (city, date, budget, etc.). Logic in `ask.ts` ensures all required fields are collected before plan generation.
2. **Generation (PLAN):** Once all data is collected, a comprehensive plan is generated. Budget allocations are normalized in code to sum exactly to the total, weighted by user priorities.
3. **Re-planning (RE-PLAN):** Any message changing core event parameters triggers a re-plan. The LLM extracts the changes and proposes trade-offs. A visual diff is generated for user approval before commit.

### AI vs. Plain Code
- **AI:** Data extraction, budget weighting, task description generation, re-plan impact analysis, vendor comparison, "what-if" scenarios, and witty mascot dialogue.
- **Code:** Stage transitions, budget normalization (sum-to-total), backward scheduling logic, database versioning, and mascot physics/animations.

---

## Diya Mascot

Diya is a stateful, mood-reactive companion implemented in `components/diya/`.

- **Moods:** `wave`, `greet`, `thinking`, `celebrate`, `worried`, `idle`, `sleep` — crossfaded via Framer Motion.
- **Placements:** landing "Light the Lamp" hero sequence, floating corner companion, journey stepper, budget watcher, bill scanner, delay alerts, typing indicator, empty states, celebration moment, and a command center.
- **Settings:** an On / Reduced / Off intensity toggle (persisted in `localStorage` as `mascot-pref`). The settings entry point stays visible even when the mascot is hidden so it can be re-enabled.
- **Easter eggs:** click Diya five times to trigger party mode; enter the Konami code to make Diya sprint across the screen.
- **Performance:** animations use only `transform`/`opacity`; heavy elements (e.g. confetti) are lazy-loaded and the mascot is `dynamic(..., { ssr: false })`.

---

## 4-Step Demo Script

1. **The Birthday Prompt:** Type "I want to plan a 1st birthday party for my daughter in Bangalore on Dec 15th for 100 people."
2. **Priorities:** When Eve asks for priorities, say "Food is most important, followed by Decor, then Photography, Venue, and Entertainment."
3. **The Plan:** Review the generated plan, timeline, and budget. Notice how Food has the largest allocation.
4. **The Re-plan:** Type "Budget dropped 30%, and the event is now 2 weeks earlier." Accept the trade-offs Eve proposes in the diff modal.

---

## Available Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run test` | Run Vitest unit tests |
| `npm run db:migrate` | Apply `db/schema.sql` to Neon |

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS, Inter / Plus Jakarta Sans |
| Animation | Framer Motion |
| State | Zustand |
| LLM | OpenRouter → Llama 3.3 70B, GPT-4o mini fallback |
| Database | Neon serverless Postgres |
| Auth | Neon Auth (Managed Better Auth) |
| Functions | Neon Functions |
| Data fetching | SWR (3 s polling) |
| Charts | Recharts |
| Validation | Zod |
| Testing | Vitest |

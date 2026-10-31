-- EventMate Live – database schema
-- Run via: npm run db:migrate

-- Enable pgcrypto for gen_random_uuid() on older Postgres versions
-- (Neon ships Postgres 16 which has it built-in)

-- -----------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage        TEXT        NOT NULL DEFAULT 'ask',
  answers      JSONB       NOT NULL DEFAULT '{}',
  event_type   TEXT,
  event_date   DATE,
  budget_total NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID        REFERENCES events(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  start_time   TIMESTAMPTZ,
  duration_min INT,
  owner_name   TEXT,
  owner_phone  TEXT,
  depends_on   UUID[]      NOT NULL DEFAULT '{}',
  budget_item  TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending'
);

-- -----------------------------------------------------------------------
-- budget_items
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_items (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID    REFERENCES events(id) ON DELETE CASCADE,
  category   TEXT    NOT NULL,
  allocated  NUMERIC NOT NULL,
  actual     NUMERIC NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------
-- expenses
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        REFERENCES events(id) ON DELETE CASCADE,
  vendor     TEXT        NOT NULL,
  amount     NUMERIC     NOT NULL,
  category   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        REFERENCES events(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- plan_versions
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_versions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        REFERENCES events(id) ON DELETE CASCADE,
  version     INT         NOT NULL,
  plan        JSONB       NOT NULL,
  change_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

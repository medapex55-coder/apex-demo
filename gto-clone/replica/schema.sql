-- Optional server schema (Postgres / Supabase) for when accounts are added.
-- v1 stores the same shapes in localStorage key "gtoc.v1".

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  settings jsonb not null default '{}',   -- theme, bet_units ('pct'|'bb'), hotkeys
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table drills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  config jsonb not null,                  -- spot path, hero pos, mode, difficulty, rng, speed, timebank
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on drills (user_id);

create table trainer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  drill_id uuid references drills(id) on delete set null,
  config jsonb not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  hands_count int not null default 0,
  decisions_count int not null default 0,
  mistakes_count int not null default 0,
  score_sum numeric not null default 0,   -- sum of per-decision scores in [-1, 1]
  ev_loss_bb numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on trainer_sessions (user_id, started_at desc);

create table trainer_hands (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references trainer_sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  hero_pos text not null check (hero_pos in ('UTG','HJ','CO','BTN','SB','BB')),
  hero_cards text not null,               -- e.g. 'AsKd'
  board text not null default '',
  actions jsonb not null default '[]',
  ev_loss_bb numeric not null default 0,
  score numeric not null default 0,
  created_at timestamptz not null default now()
);
create index on trainer_hands (session_id);
create index on trainer_hands (user_id, ev_loss_bb desc);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references trainer_hands(id) on delete cascade,
  node_path text not null,
  chosen text not null,
  gto_freqs jsonb not null,
  grade text not null check (grade in ('best','correct','inaccuracy','wrong','blunder')),
  ev_loss_bb numeric not null default 0,
  rng_roll int check (rng_roll between 1 and 100),
  created_at timestamptz not null default now()
);
create index on decisions (hand_id);

-- Supabase RLS (when used)
alter table drills enable row level security;
alter table trainer_sessions enable row level security;
alter table trainer_hands enable row level security;
create policy own_drills on drills using (user_id = auth.uid());
create policy own_sessions on trainer_sessions using (user_id = auth.uid());
create policy own_hands on trainer_hands using (user_id = auth.uid());
create policy own_decisions on decisions using (
  exists (select 1 from trainer_hands h where h.id = hand_id and h.user_id = auth.uid())
);

# Supabase Setup For Distributed Railway Booking System

This guide shows how to connect the existing project to Supabase.

The project architecture stays the same:

```text
Next.js Frontend
   |
   v
Load Balancer  --->  Supabase Database
   |
   +--> Server 1
   +--> Server 2
   +--> Server 3
```

Supabase is used for persistent:

- confirmed bookings
- waitlist entries
- VIP success counter metadata

Pending bookings and short 1-minute seat locks remain in the load balancer because they are temporary runtime locks.

---

## 1. Create Supabase Project

1. Go to `https://supabase.com`
2. Sign in
3. Click **New project**
4. Choose an organization
5. Enter a project name, for example:

```text
railway-ticket-system
```

6. Create a database password
7. Select a region near you
8. Wait until the project is ready

---

## 2. Get Supabase URL And Anon Key

In Supabase:

1. Open your project
2. Go to **Project Settings**
3. Go to **API**
4. Copy:

```text
Project URL
```

5. Copy:

```text
anon public key
```

These will become:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

---

## 3. Create Tables In Supabase

In Supabase:

1. Open your project
2. Go to **SQL Editor**
3. Click **New query**
4. Paste this SQL
5. Click **Run**

```sql
create table if not exists bookings (
  booking_id text primary key,
  request_id integer,
  username text not null,
  train_id text not null,
  train_name text,
  source text,
  destination text,
  seat_id text,
  seat_type text,
  status text not null check (status in ('SUCCESS', 'CONFIRMED', 'CANCELLED')),
  is_vip boolean not null default false,
  requested_vip boolean not null default false,
  vip_notice text,
  server_id text,
  server_name text,
  timestamp_ms bigint not null,
  created_at_iso text,
  updated_at timestamptz default now()
);

create table if not exists waitlist (
  booking_id text primary key,
  request_id integer,
  username text not null,
  train_id text not null,
  train_name text,
  source text,
  destination text,
  seat_id text,
  seat_type text,
  status text not null check (status = 'WAITLISTED'),
  is_vip boolean not null default false,
  requested_vip boolean not null default false,
  vip_notice text,
  server_id text,
  server_name text,
  timestamp_ms bigint not null,
  created_at_iso text,
  updated_at timestamptz default now()
);

create table if not exists meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

create index if not exists bookings_train_status_idx
on bookings (train_id, status);

create index if not exists bookings_vip_status_idx
on bookings (is_vip, status);

create index if not exists waitlist_priority_idx
on waitlist (is_vip desc, timestamp_ms asc);

create index if not exists waitlist_train_priority_idx
on waitlist (train_id, is_vip desc, timestamp_ms asc);
```

---

## 4. Temporarily Disable RLS For Demo

For a college demo, the simplest setup is to disable Row Level Security on these three tables.

In Supabase:

1. Go to **Table Editor**
2. Open `bookings`
3. Find **RLS**
4. Disable it
5. Repeat for:

```text
waitlist
meta
```

Important:

This is okay for local demo.
For production, use secure RLS policies or a service role key on a private backend only.

---

## 5. Add Environment Variables

Create this file:

```text
load-balancer/.env
```

Add:

```bash
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

If you start the load balancer from terminal directly, you can also pass them inline:

```bash
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co SUPABASE_ANON_KEY=YOUR_ANON_KEY PORT=5100 SERVER1_URL=http://localhost:5101 SERVER2_URL=http://localhost:5102 SERVER3_URL=http://localhost:5103 npm run dev --workspace load-balancer
```

The load balancer automatically reads this file when it starts.

You may also use terminal `export` commands instead:

```bash
export SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
export SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Then start the load balancer from the same terminal.

---

## 6. Install Dependency

From the project root:

```bash
npm install
```

The load balancer now uses:

```text
@supabase/supabase-js
```

---

## 7. Run The Whole System

Use 5 terminals.

### Terminal 1

```bash
PORT=5101 npm run dev --workspace server1
```

### Terminal 2

```bash
PORT=5102 npm run dev --workspace server2
```

### Terminal 3

```bash
PORT=5103 npm run dev --workspace server3
```

### Terminal 4

```bash
export SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
export SUPABASE_ANON_KEY=YOUR_ANON_KEY

PORT=5100 SERVER1_URL=http://localhost:5101 SERVER2_URL=http://localhost:5102 SERVER3_URL=http://localhost:5103 npm run dev --workspace load-balancer
```

### Terminal 5

```bash
PORT=3200 NEXT_PUBLIC_API_BASE_URL=http://localhost:5100 npm run dev --workspace frontend
```

Open:

- Dashboard: `http://localhost:3200`
- Booking Page: `http://localhost:3200/book`

---

## 8. What To Show Your Teacher

### Step 1. Show empty tables

In Supabase Table Editor, open:

- `bookings`
- `waitlist`
- `meta`

### Step 2. Book a normal ticket

On the booking page:

1. Enter passenger name
2. Select source
3. Select destination
4. Keep VIP unchecked
5. Click **Request Booking**
6. Click **Process Payment**

Now check Supabase:

- one row should appear in `bookings`

### Step 3. Book VIP tickets

Create VIP bookings.

Only 4 VIP bookings can have `status = SUCCESS`.

Check Supabase:

- `bookings.is_vip = true`
- `meta` key `vip_success_count` should update

### Step 4. Create more VIP requests

After 4 VIP successes, extra VIP users should go to `waitlist`.

Check Supabase:

- VIP waitlisted rows appear in `waitlist`
- `is_vip = true`
- `status = WAITLISTED`

### Step 5. Cancel a confirmed booking

In Dashboard:

1. Select a confirmed booking
2. Click **Cancel Selected**

Then check Supabase:

- cancelled booking becomes `CANCELLED`
- the next eligible waitlist row is removed from `waitlist`
- that user is inserted/upserted into `bookings` as `SUCCESS`

---

## 9. Current VIP Rule

The current rule is:

```text
Maximum 4 VIP successful bookings across the system.
```

Extra VIP users:

```text
WAITLISTED
```

They are not rejected.

---

## 10. Waitlist Priority Rule

The system uses:

```text
VIP first, then Normal.
FIFO inside each group.
```

Meaning:

```text
VIP request at 10:00 gets priority over VIP request at 10:05
Normal request at 10:00 gets priority over Normal request at 10:05
```

But a VIP waitlisted user can only be promoted if VIP success count is below 4.

---

## 11. If Supabase Is Not Configured

The system still runs.

The load balancer prints:

```text
Supabase is not configured. Continuing with in-memory booking state.
```

This helps local testing, but for your teacher demo, configure Supabase so rows are visible.

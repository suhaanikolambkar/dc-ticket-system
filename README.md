# Distributed Railway Booking Simulation

This project simulates a distributed railway booking system using:

- `load-balancer` on port `5000`
- `server1` on port `5001`
- `server2` on port `5002`
- `server3` on port `5003`
- `frontend` on port `3000`

## Features

- Hybrid load balancing across active servers
- Health checks and fault tolerance
- Shared in-memory seat locking
- Async notification logging
- Live Next.js dashboard with request logs and successful bookings

## Run

1. Install dependencies from the project root:

```bash
npm install
```

2. Start the full system:

```bash
npm run start:all
```

3. Open the dashboard:

```text
http://localhost:3000
```

Passenger booking page:

```text
http://localhost:3000/book
```

If you get `address already in use`, one of the default ports is busy on your machine. You can either stop the conflicting process or run the app on alternate ports.

Check which process owns a port:

```bash
lsof -nP -iTCP:5000 -sTCP:LISTEN
```

Repeat for `3000`, `5001`, `5002`, or `5003` if needed.

Example alternate-port startup:

```bash
PORT=5101 npm run dev --workspace server1
PORT=5102 npm run dev --workspace server2
PORT=5103 npm run dev --workspace server3
PORT=5100 SERVER1_URL=http://localhost:5101 SERVER2_URL=http://localhost:5102 SERVER3_URL=http://localhost:5103 npm run dev --workspace load-balancer
```

Then start the frontend with the matching API URL:

```bash
PORT=3100 NEXT_PUBLIC_API_BASE_URL=http://localhost:5100 npm run dev --workspace frontend
```

## Manual API checks

- Load balancer state: `GET http://localhost:5000/dashboard-state`
- Send one request: `GET http://localhost:5000/request`
- Submit booking form request: `POST http://localhost:5000/book`
- Fail server 1: `POST http://localhost:5000/admin/fail/server1`
- Recover server 1: `POST http://localhost:5000/admin/recover/server1`
- Reset dashboard + bookings + loads: `POST http://localhost:5000/admin/reset`

## Notes

- Requires Node.js `18+`
- All state is kept in memory
- Dashboard uses least-connections routing across active nodes
- `Refresh Dashboard` now performs a full in-memory reset of logs, bookings, seats, and server loads

# Distributed Railway Booking System - Detailed Explanation

## 1. What This Project Is

This project is a **distributed railway ticket booking system simulation**.

It is called distributed because the work is not done by only one backend server.
Instead, the system has:

- one **frontend**
- one **load balancer / coordinator**
- three **backend servers**

The frontend sends requests to the load balancer.
The load balancer decides which backend server should process each request.

This project demonstrates:

- load balancing
- fault tolerance
- health checks
- seat locking
- VIP priority booking
- waitlist handling
- admin cancellation
- automatic waitlist upgrade
- real-time dashboard updates
- persistent confirmed bookings and waitlist rows using Supabase

Temporary state is stored **in memory**.
Confirmed bookings, waitlist entries, and VIP counter metadata can now be stored in **Supabase**.

---

## 2. Tech Stack Used

### Frontend

- **Next.js**
- **React**
- plain CSS through `frontend/app/globals.css`

### Backend

- **Node.js**
- **Express**
- **Supabase JavaScript Client**
- **Supabase Database**

### Project Structure Style

- **npm workspaces**
- one workspace for each server/component

### Communication

- **HTTP REST APIs**
- JSON request and response bodies

### Data Storage

- **Supabase `bookings` table** for confirmed/cancelled bookings
- **Supabase `waitlist` table** for waitlisted bookings
- **Supabase `meta` table** for VIP success counter metadata
- **in-memory JavaScript objects, arrays, and maps** for temporary pending requests, live logs, health, and 1-minute locks
- no MySQL
- no MongoDB
- no Redis

Supabase setup is explained separately in:

- [SUPABASE_SETUP.md](/Users/suhanikolambkar/Desktop/dc-ticket-system/SUPABASE_SETUP.md)

---

## 3. High-Level Architecture

```text
User / Admin
    |
    v
Next.js Frontend
    |
    v
Load Balancer (Main Coordinator)
    |
    +--> Supabase Database
    |
    +--> Server 1
    +--> Server 2
    +--> Server 3
```

### What each part does

#### Frontend

The frontend provides:

- dashboard page
- booking page
- simulation control
- fail/recover buttons
- cancellation controls
- pending / confirmed / waitlist display

It does **not** decide server routing.

#### Load Balancer

This is the **brain** of the system.

It:

- receives all booking requests
- stores the shared booking state
- keeps train data
- locks seats
- tracks pending bookings
- processes payment state
- maintains VIP priority logic
- maintains waitlist logic
- routes requests to backend servers
- checks backend health
- removes down servers from routing
- builds the dashboard response

#### Backend Servers

These simulate worker nodes.

They:

- receive `/process` requests
- simulate processing delay
- increase/decrease load
- keep per-server logs
- expose `/status`
- can be failed, recovered, and reset

These servers do **not** own booking truth.
The load balancer owns the booking truth.

---

## 4. How To Run The Project

## Install dependencies

From the project root:

```bash
npm install
```

## Recommended run method

Use separate terminals:

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
PORT=5100 SERVER1_URL=http://localhost:5101 SERVER2_URL=http://localhost:5102 SERVER3_URL=http://localhost:5103 npm run dev --workspace load-balancer
```

### Terminal 5

```bash
PORT=3200 NEXT_PUBLIC_API_BASE_URL=http://localhost:5100 npm run dev --workspace frontend
```

## Open in browser

- Dashboard: `http://localhost:3200`
- Booking page: `http://localhost:3200/book`

## If you want the default ports

- frontend: `3000`
- load balancer: `5000`
- server1: `5001`
- server2: `5002`
- server3: `5003`

But custom ports are safer because default ports may already be busy.

## If frontend behaves strangely after changes

Clear the Next.js cache:

```bash
rm -rf frontend/.next
```

Then start the services again.

---

## 5. Folder and File Explanation

## Root files

### `package.json`

This is the root workspace configuration.

It defines:

- all workspaces
- the `start:all` script

File: [package.json](/Users/suhanikolambkar/Desktop/dc-ticket-system/package.json)

### `README.md`

Short run instructions and project summary.

File: [README.md](/Users/suhanikolambkar/Desktop/dc-ticket-system/README.md)

### `PROJECT_EXPLANATION.md`

This file.
It explains how the project works.

File: [PROJECT_EXPLANATION.md](/Users/suhanikolambkar/Desktop/dc-ticket-system/PROJECT_EXPLANATION.md)

---

## Load balancer

### `load-balancer/index.js`

Most important backend file.

This file contains:

- train configuration
- server registry
- health checks
- least-load routing logic
- booking creation
- payment processing
- VIP logic
- waitlist logic
- cancellation logic
- dashboard state API
- reset API

File: [load-balancer/index.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/load-balancer/index.js)

### `load-balancer/package.json`

Workspace package file for the load balancer.

File: [load-balancer/package.json](/Users/suhanikolambkar/Desktop/dc-ticket-system/load-balancer/package.json)

---

## Backend servers

### `shared/createBackendServer.js`

Shared factory used by all three backend servers.

It avoids repeating the same code three times.

This file defines:

- request processing behavior
- current load
- server failure state
- request counters
- activity logs
- status endpoint
- admin endpoints

File: [shared/createBackendServer.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/shared/createBackendServer.js)

### `server1/index.js`

Starts backend server 1.

File: [server1/index.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/server1/index.js)

### `server2/index.js`

Starts backend server 2.

File: [server2/index.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/server2/index.js)

### `server3/index.js`

Starts backend server 3.

File: [server3/index.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/server3/index.js)

---

## Frontend

### `frontend/app/page.js`

Admin dashboard page.

It shows:

- simulation controls
- train summary
- server status
- request logs
- pending bookings
- confirmed bookings
- waitlist

File: [frontend/app/page.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/frontend/app/page.js)

### `frontend/app/book/page.js`

Passenger booking page.

It handles:

- name input
- source selection
- destination selection
- seat type
- number of seats
- VIP checkbox
- request booking
- process payment

File: [frontend/app/book/page.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/frontend/app/book/page.js)

### `frontend/app/globals.css`

Main project styling.

File: [frontend/app/globals.css](/Users/suhanikolambkar/Desktop/dc-ticket-system/frontend/app/globals.css)

### `frontend/package.json`

Frontend workspace package file.

File: [frontend/package.json](/Users/suhanikolambkar/Desktop/dc-ticket-system/frontend/package.json)

---

## 6. Trains Used In The Current System

The current system uses only **3 trains**.
Each train has **100 seats**.

### Train 1

- `trainId`: `TR101`
- `name`: `Express 1`
- `source`: `Mumbai`
- `destination`: `Pune`

### Train 2

- `trainId`: `TR202`
- `name`: `Express 2`
- `source`: `Delhi`
- `destination`: `Jaipur`

### Train 3

- `trainId`: `TR303`
- `name`: `Express 3`
- `source`: `Surat`
- `destination`: `Nagpur`

This is defined in:

- [load-balancer/index.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/load-balancer/index.js#L11)

---

## 7. Core Features Of The System

### 1. Load balancing

Requests are distributed across active backend servers.

### 2. Fault tolerance

If one server goes down, requests move to the other servers.

### 3. Health checks

The load balancer checks the health of all backend servers repeatedly.

### 4. Seat locking

Seats are locked for pending bookings so they are not double-booked.

### 5. Payment-controlled confirmation

Booking is not confirmed until payment is processed.

### 6. VIP booking

VIP users get priority, but there is a max limit of 4 VIP successful bookings in the running system.

### 7. Waitlist queue

If seats are full, users go to the waitlist.

### 8. Admin cancellation

Admin can cancel confirmed bookings.

### 9. Automatic waitlist upgrade

When a seat is freed, the next eligible waitlisted user is moved to confirmed status.

### 10. Real-time dashboard

Frontend polls backend state and updates automatically.

---

## 8. Which Algorithm Is Used?

## A. Load balancing algorithm

The routing algorithm is:

- **Least-load**
- also similar to **least-connections**

Meaning:

- each server has a `currentLoad`
- the load balancer chooses the active server with the smallest load

Important functions:

- `getActiveServers(...)`
- `selectServer(...)`
- `chooseLeastLoad(...)`

Where:

- [load-balancer/index.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/load-balancer/index.js#L194)

### How it works

1. Check which servers are active
2. Ignore down servers
3. Prefer servers with load below capacity
4. Pick the one with smallest `currentLoad`
5. If two servers have the same load, choose one randomly to avoid bias

This prevents the system from always sending traffic to Server 1.

---

## B. Waitlist algorithm

The waitlist uses:

- **FIFO inside each queue**

Meaning:

- first request gets higher priority than later requests
- queue is sorted by timestamp

Function:

- `sortByTimestamp(queue)`

VIP and normal users are separated into:

- `vipQueue`
- `normalQueue`

Promotion rule:

1. check VIP queue first
2. then check normal queue

This means:

- VIP has queue priority
- FIFO is preserved inside each queue

---

## 9. How The Backend Works Step By Step

Let us follow one booking request.

## Step 1. User opens booking page

Booking page:

- [frontend/app/book/page.js](/Users/suhanikolambkar/Desktop/dc-ticket-system/frontend/app/book/page.js)

User fills:

- name
- source
- destination
- seat type
- number of seats
- VIP checkbox

Frontend maps source and destination to the correct train.

---

## Step 2. User clicks "Request Booking"

Frontend sends:

- `POST /request-booking`

To:

- load balancer

The load balancer receives the request and creates **pending bookings**.

Important function:

- `createPendingBookings(input)`

That function:

1. validates seat count
2. calls `createPendingBooking(...)` for each seat
3. creates one internal booking per seat

So if user books 3 seats:

- 3 internal pending booking requests are created

---

## Step 3. Load balancer resolves the train

Function:

- `resolveRequestedTrain(input)`

This checks:

- source + destination
- or trainId if already present

This is where route mapping happens.

---

## Step 4. Load balancer chooses a backend server

Function:

- `selectServer()`

This uses:

- `getActiveServers(...)`
- `chooseLeastLoad(...)`

The chosen server is the active server with the least load.

---

## Step 5. Seat locking happens

Function:

- `findAvailableSeat(trainState, seatType)`

If a seat is available:

- seat becomes `locked`
- `lockedBy = requestId`

Booking state becomes:

- `PENDING`

This is stored in:

- `pendingBookingMap`
- `pendingBookings`

The seat lock timeout is:

- `PENDING_LOCK_MS = 60000`

which means **1 minute**.

---

## Step 6. If payment is not done

Function:

- `expirePendingBooking(requestId)`

After 1 minute:

- pending booking becomes failed
- seat becomes available again
- payment timeout counter increases

This shows the seat locking and expiry mechanism.

---

## Step 7. User clicks "Process Payment"

Frontend sends:

- `POST /process-payment`

The load balancer then processes each pending request.

Function:

- `processPaymentForBookings(requestIds)`

It loops through each request ID and calls:

- `processPaymentForBooking(requestId)`

---

## Step 8. Load balancer sends work to backend server

Inside payment processing, the load balancer calls:

- `dispatchProcess(pending)`

This sends an HTTP request to the selected backend server:

- `GET /process`

Before sending:

- server load is increased

After backend finishes:

- server load is decreased

That is why you can see live load numbers on the dashboard.

---

## Step 9. Confirmed booking or waitlist

After processing:

### If seat is available

- seat becomes `booked`
- booking goes to `confirmedBookings`
- booking also appears in `successfulBookings`

### If train is full

- booking goes to:
  - `vipQueue`, or
  - `normalQueue`

Function:

- `enqueueWaitlist(trainState, booking)`

---

## Step 10. VIP logic

VIP rule:

- maximum 4 VIP successful bookings

If VIP user requests booking:

- system tries to keep VIP priority

If VIP limit is already full:

- user stays VIP
- user is moved to the waitlist
- the user is not rejected

This is tracked using:

- `vipCount`
- `vip_success_count` metadata in Supabase

---

## Step 11. Admin cancellation

Dashboard can cancel bookings using:

- `POST /cancel-booking`

Function:

- `cancelBooking(bookingId, trainId)`

When admin cancels:

1. booking is removed from confirmed list
2. seat becomes available
3. if user was VIP, `vipCount` decreases
4. system checks the waitlist

Then:

- first eligible waitlisted user is promoted

Function:

- `promoteWaitlistedBooking(trainState, freedSeatId)`

Promotion rule:

1. VIP queue first
2. normal queue next
3. FIFO inside each queue

---

## 10. How Load Balancer Checks Before Passing To Servers

This is one of the most important parts.

Before work is sent to a backend server, the system checks:

### 1. Is train valid?

Function:

- `resolveRequestedTrain(input)`

### 2. Is seat count valid?

Function:

- `normalizeSeatCount(value)`

### 3. Is a backend server active?

Function:

- `selectServer()`

This only considers:

- servers where `status === "active"`

### 4. Is a seat available?

Function:

- `findAvailableSeat(trainState, seatType)`

### 5. Has payment been requested?

Only pending bookings can move to processing.

Function:

- `processPaymentForBooking(requestId)`

### 6. Is the server alive right now?

The load balancer keeps refreshing server health:

- `refreshServer(server)`
- `refreshAllServers()`

If a server fails:

- mark as down
- reroute to other active servers

So the actual check-before-processing flow is:

```text
Validate request
-> resolve train
-> choose active least-loaded server
-> lock seat
-> wait for payment
-> send /process to backend server
-> confirm or waitlist
```

---

## 11. Important Backend APIs Used

Yes, this project uses APIs.

These are **internal APIs** used by the frontend and the load balancer.

## Frontend -> Load Balancer APIs

### `GET /dashboard-state`

Returns:

- server status
- loads
- counters
- train summary
- pending bookings
- confirmed bookings
- waitlist
- request logs

### `GET /request`

Used by simulation.
Creates random traffic automatically.

### `POST /request-booking`

Creates pending bookings.

Input example:

```json
{
  "name": "Rahul Sharma",
  "source": "Mumbai",
  "destination": "Pune",
  "seatType": "2A",
  "numberOfSeats": 2,
  "isVIP": true
}
```

### `POST /process-payment`

Confirms pending bookings.

Input example:

```json
{
  "requestIds": [1, 2]
}
```

### `POST /cancel-booking`

Cancels a confirmed booking.

Input example:

```json
{
  "bookingId": "BK-5",
  "trainId": "TR101"
}
```

### `GET /bookings/:trainId`

Returns bookings for one train.

### `POST /admin/fail/:serverId`

Marks a backend server as down.

### `POST /admin/recover/:serverId`

Recovers a backend server.

### `POST /admin/reset`

Resets the full simulation state.

---

## Load Balancer -> Backend Server APIs

### `GET /status`

Checks if backend server is alive and gets:

- current load
- capacity
- processed request count
- activity logs

### `GET /process`

Asks backend server to process one request.

### `POST /admin/fail`

Fails one backend server.

### `POST /admin/recover`

Recovers one backend server.

### `POST /admin/reset`

Resets one backend server.

### `POST /admin/log`

Adds activity log entry to a backend server.

---

## 12. How Synchronization Works

This is very important in distributed systems.

If all three backend servers managed booking state separately, the system could become inconsistent.

Example problem:

- Server 1 thinks seat A is free
- Server 2 also thinks seat A is free
- two users book the same seat

To avoid that, this project uses **centralized coordination** through the load balancer and **persistent storage** through Supabase.

### What is centralized?

The load balancer centrally coordinates:

- train state
- seat state
- pending bookings
- logs

Supabase stores:

- successful bookings
- cancelled booking status
- waitlist
- VIP counter metadata

### What do backend servers do then?

Backend servers only simulate processing work.

This means synchronization happens because:

- the load balancer coordinates all writes
- Supabase persists confirmed booking and waitlist state

This is a simple but very effective way to simulate distributed coordination safely.

---

## 13. How To Show The Backend Working In A Demo

Yes, you can absolutely show the backend working.

## Option 1. Show terminal logs

Keep all 5 terminals open:

- server1 terminal
- server2 terminal
- server3 terminal
- load balancer terminal
- frontend terminal

Then:

- start simulation
- fail one server
- show that traffic continues on the other servers

Backend server terminals print messages like:

- request processing started
- request completed
- server marked down
- server recovered

This is the best way to visually show backend behavior.

## Option 2. Show the dashboard

Dashboard shows:

- server load
- request count
- server activity
- pending bookings
- confirmed bookings
- waitlist

This is the visual representation of backend state.

## Option 3. Show API responses

You can run:

```bash
curl http://localhost:5100/dashboard-state
```

or:

```bash
curl http://localhost:5101/status
```

This helps prove that backend APIs are working.

---

## 14. Important Functions And What They Do

## In `load-balancer/index.js`

### `createServerState(...)`

Creates server objects for the load balancer's registry.

### `createTrainState(...)`

Creates one train state with:

- seat map
- confirmed bookings
- VIP queue
- normal queue
- VIP count

### `buildUniqueSimulationNames()`

Creates many unique names for simulation traffic.

### `resolveRequestedTrain(input)`

Maps:

- source + destination

to:

- correct train

### `getActiveServers(...)`

Returns only active backend servers.

### `chooseLeastLoad(...)`

Finds the lowest loaded server.

### `selectServer(...)`

Main routing selection function.

### `refreshServer(server)`

Performs health check on one backend node.

### `refreshAllServers()`

Runs health checks on all backend nodes.

### `findAvailableSeat(trainState, seatType)`

Searches for a free seat.

### `createPendingBooking(input)`

Creates one pending booking request.

### `createPendingBookings(input)`

Creates multiple pending bookings if user requests multiple seats.

### `expirePendingBooking(requestId)`

Expires unpaid pending booking after 1 minute.

### `dispatchProcess(pending)`

Actually sends processing work to one backend server.

### `enqueueWaitlist(trainState, booking)`

Adds user to waitlist.

### `promoteWaitlistedBooking(trainState, freedSeatId)`

Moves next waitlisted user to confirmed when a seat is freed.

### `processPaymentForBooking(requestId)`

Main booking confirmation function.

### `cancelBooking(bookingId, trainId)`

Admin cancellation function.

### `createSystemState()`

Builds the full dashboard JSON response.

---

## In `shared/createBackendServer.js`

### `createBackendServer(...)`

Creates an Express server instance for one backend node.

### `randomDelay()`

Simulates server processing delay.

### `pushActivity(entry)`

Stores server activity logs.

### `resetState()`

Resets backend server state.

### `/process`

Simulates actual processing.

### `/status`

Health check endpoint.

### `/admin/fail`

Sets server to down.

### `/admin/recover`

Recovers server.

### `/admin/reset`

Resets server state.

### `/admin/log`

Adds manual activity entries from load balancer.

---

## 15. Why This Is A Distributed Computing Project

This project qualifies as distributed computing because:

- multiple backend nodes exist
- requests are distributed across nodes
- a coordinator decides routing
- failures are handled
- load is balanced
- system state must remain consistent

Important distributed-system concepts shown here:

- coordination
- fault tolerance
- load balancing
- health monitoring
- concurrency control
- queue management
- real-time state aggregation

Even though all of it runs on one machine for simulation, the architecture models a distributed system.

---

## 16. Simple Summary You Can Say In Viva

You can explain it like this:

> This project is a distributed railway booking simulation built with Next.js, Node.js, Express, and Supabase. The frontend sends all requests to a central load balancer. The load balancer acts as the coordinator. It checks server health, performs least-load routing, manages seat locking, processes payment-based confirmation, handles VIP priority and waitlist logic, persists confirmed/waitlisted bookings in Supabase, and sends work to three backend servers. The backend servers simulate real worker nodes by processing requests and reporting their live load and activity. The dashboard shows all of this in real time.

---

## 17. If You Want To Explain It Very Simply

Very simple version:

1. User enters booking details
2. Frontend sends request to load balancer
3. Load balancer picks the least busy active server
4. Seat is locked for 1 minute
5. If payment succeeds, booking is confirmed
6. If seats are full, user goes to waitlist
7. VIP users get priority
8. If admin cancels a booking, next waitlisted user gets promoted
9. Dashboard keeps showing all updates live

---

## 18. Final Notes

- This project uses **Supabase for confirmed bookings and waitlist**, so demo bookings can remain after restart.
- Temporary pending bookings and 1-minute seat locks are still in memory.
- It is excellent for learning distributed system ideas.
- In a real production system, the shared state would move to a database or distributed cache.
- The current design is intentionally centralized in the load balancer to keep synchronization safe and easy to understand.

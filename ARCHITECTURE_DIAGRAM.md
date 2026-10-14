# Distributed Railway Booking System - Architecture Diagram

## 1. Block Diagram With Intermediate Stages

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  DISTRIBUTED RAILWAY BOOKING SYSTEM                         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

                                        ┌──────────────────────────────┐
                                        │            USERS             │
                                        │──────────────────────────────│
                                        │ Passenger                    │
                                        │ Admin                        │
                                        └──────────────┬───────────────┘
                                                       │
                                             HTTP / Browser Requests
                                                       │
                                                       v
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                                NEXT.JS FRONTEND LAYER                                       │
│──────────────────────────────────────────────────────────────────────────────────────────────│
│ Booking Page                                                                               │
│ - Name                                                                                     │
│ - Source / Destination                                                                     │
│ - Number of Seats                                                                          │
│ - VIP Checkbox                                                                             │
│ - Request Booking                                                        #                  │
│ - Process Payment                                                                          │
│                                                                                             │
│ Admin Dashboard                                                                            │
│ - Start Simulation                                                                         │
│ - Reset Simulation                                                                         │
│ - Fail / Recover Servers                                                                   │
│ - Server Load                                                                              │
│ - Logs                                                                                     │
│ - Pending / Successful / Waitlist Views                                                    │
└──────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                       │
                                 REST API Calls
                                       │
                                       v
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                           LOAD BALANCER / COORDINATOR                                      │
│──────────────────────────────────────────────────────────────────────────────────────────────│
│ Request Validation                                                                          │
│ - validate seats (max 4)                                                                    │
│ - map source+destination -> trainId                                                         │
│                                                                                              │
│ Routing Logic                                                                               │
│ - least-load server selection                                                               │
│ - active server filtering                                                                    │
│ - failover when a node is down                                                              │
│                                                                                              │
│ Booking Control                                                                             │
│ - pending booking creation                                                                   │
│ - seat locking                                                                              │
│ - payment confirmation                                                                      │
│ - VIP cap check                                                                             │
│ - waitlist insertion                                                                        │
│ - cancellation handling                                                                     │
│ - waitlist upgrade                                                                          │
│                                                                                              │
│ Monitoring                                                                                  │
│ - health checks                                                                             │
│ - request logs                                                                              │
│ - dashboard state aggregation                                                               │
└───────────────┬───────────────────────────────┬───────────────────────────────┬──────────────┘
                │                               │                               │
                │ least-load routing            │ least-load routing            │ least-load routing
                v                               v                               v
     ┌──────────────────────┐        ┌──────────────────────┐        ┌──────────────────────┐
     │      SERVER 1        │        │      SERVER 2        │        │      SERVER 3        │
     │──────────────────────│        │──────────────────────│        │──────────────────────│
     │ Node.js + Express    │        │ Node.js + Express    │        │ Node.js + Express    │
     │ /process             │        │ /process             │        │ /process             │
     │ /status              │        │ /status              │        │ /status              │
     │ currentLoad          │        │ currentLoad          │        │ currentLoad          │
     │ totalProcessed       │        │ totalProcessed       │        │ totalProcessed       │
     │ activityLogs         │        │ activityLogs         │        │ activityLogs         │
     └───────────┬──────────┘        └───────────┬──────────┘        └───────────┬──────────┘
                 │                               │                               │
                 └──────────────────────┬────────┴────────┬──────────────────────┘
                                        │                 │
                                        │                 │
                                        v                 v
                     ┌──────────────────────────────────────────────────────┐
                     │              SUPABASE DATABASE                       │
                     │──────────────────────────────────────────────────────│
                     │ bookings table                                       │
                     │ waitlist table                                       │
                     │ meta table                                           │
                     └──────────────────────────────────────────────────────┘

                     ┌──────────────────────────────────────────────────────┐
                     │         IN-MEMORY RUNTIME STATE (LB ONLY)           │
                     │──────────────────────────────────────────────────────│
                     │ pendingBookings                                      │
                     │ pendingBookingMap                                    │
                     │ seat locks (1-minute hold)                           │
                     │ server registry                                      │
                     │ live logs / counters                                 │
                     └──────────────────────────────────────────────────────┘
```

## 2. Process Flow

```text
User fills booking form
        │
        v
Frontend sends request
        │
        v
Load Balancer validates input
- name
- route
- seat count
- VIP flag
        │
        v
Route mapped to train
        │
        v
Least-loaded active server selected
        │
        v
Seat availability checked
        │
        ├── Seat available
        │      │
        │      v
        │   Seat locked for 1 minute
        │   Pending booking created
        │      │
        │      v
        │   Process Payment clicked?
        │      │
        │      ├── Yes -> backend /process -> SUCCESS or WAITLISTED
        │      └── No  -> pending expires -> seat unlocked
        │
        └── No seat available
               │
               v
        Add user to waitlist
        - VIP priority
        - FIFO inside same category
```

## 3. Concepts Of Distributed Computing Used

```text
1. Load balancing
2. Fault tolerance
3. Health checks
4. Distributed coordination
5. Concurrency control
6. Queue management
7. Failover
8. Real-time state aggregation
9. Centralized coordination with multiple worker nodes
10. Persistent state + runtime state separation
```

## 4. Distributed Computing Algorithms Used

```text
1. Least-load routing
   - choose active server with minimum currentLoad

2. Active-node filtering
   - route only to alive servers

3. Lock-based concurrency control
   - seat state: available -> locked -> booked

4. Priority queue scheduling
   - VIP users first

5. FIFO ordering
   - earliest timestamp first within same priority class

6. Automatic failover
   - if one node fails, use remaining active nodes

7. Waitlist promotion algorithm
   - on cancellation, promote next eligible user
```

## 5. Tech Stack In Detail

```text
Frontend
- Next.js
- React
- JavaScript
- CSS

Coordinator / Load Balancer
- Node.js
- Express
- CORS
- native fetch

Backend Worker Servers
- Node.js
- Express

Persistence Layer
- Supabase
- PostgreSQL (under Supabase)
- @supabase/supabase-js

Project Tooling
- npm workspaces
- concurrently
```

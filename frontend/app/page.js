"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";
const FIRST_SIMULATION_TARGET = 350;
const SECOND_SIMULATION_TARGET = 50;
const REQUEST_INTERVAL_MS = 8;

function formatTime(value) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getHighlight(state, serverId) {
  if (!state.lastTrafficAt || state.lastTrafficServerId !== serverId) {
    return false;
  }

  return Date.now() - new Date(state.lastTrafficAt).getTime() < 2000;
}

export default function DashboardPage() {
  const [state, setState] = useState({
    requestCounter: 0,
    totalSuccessfulBookings: 0,
    totalVipSuccessful: 0,
    vipSuccessLimit: 4,
    totalPendingBookings: 0,
    totalServerFailures: 0,
    totalPaymentTimeouts: 0,
    totalWaitlistedBookings: 0,
    criticalFailure: false,
    lastTrafficServerId: null,
    lastTrafficAt: null,
    servers: [],
    requestLogs: [],
    pendingBookings: [],
    bookings: [],
    waitlistQueue: [],
    trainSummaries: []
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [busyServerId, setBusyServerId] = useState(null);
  const [criticalDismissed, setCriticalDismissed] = useState(false);
  const [selectedBookings, setSelectedBookings] = useState([]);
  const [sentCount, setSentCount] = useState(0);
  const [message, setMessage] = useState("Ready to simulate distributed traffic.");
  const intervalRef = useRef(null);

  async function fetchState() {
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard-state`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Dashboard state request failed");
      }
      const data = await response.json();
      setState(data);
    } catch (_error) {
      setMessage("Dashboard is waiting for backend services to start.");
    }
  }

  useEffect(() => {
    fetchState();
    const poller = setInterval(fetchState, 300);

    return () => {
      clearInterval(poller);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!state.criticalFailure) {
      setCriticalDismissed(false);
    }
  }, [state.criticalFailure]);

  function toggleBookingSelection(bookingId) {
    setSelectedBookings((current) =>
      current.includes(bookingId)
        ? current.filter((id) => id !== bookingId)
        : [...current, bookingId]
    );
  }

  function startSimulation() {
    if (isRunning) {
      return;
    }

    const target = state.requestCounter < FIRST_SIMULATION_TARGET
      ? Math.max(0, FIRST_SIMULATION_TARGET - state.requestCounter)
      : SECOND_SIMULATION_TARGET;
    if (target === 0) {
      return;
    }

    setIsRunning(true);
    setSentCount(0);
    setMessage(`Simulation started: sending ${target} distributed requests.`);

    let count = 0;
    intervalRef.current = setInterval(() => {
      count += 1;
      setSentCount(count);

      fetch(`${API_BASE_URL}/request`)
        .catch(() => {
          setMessage("A request could not reach the system.");
        })
        .finally(fetchState);

      if (count >= target) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        setIsRunning(false);
        setMessage(`Simulation completed after ${target} requests.`);
      }
    }, REQUEST_INTERVAL_MS);
  }

  async function updateServer(serverId, action) {
    try {
      setBusyServerId(serverId);
      const response = await fetch(`${API_BASE_URL}/admin/${action}/${serverId}`, {
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Server update failed");
      }
      setMessage(data.message || `${serverId} updated.`);
      setState(data.state);
    } catch (_error) {
      setMessage(`Could not ${action} ${serverId}.`);
    } finally {
      setBusyServerId(null);
    }
  }

  async function cancelSelectedBookings() {
    if (selectedBookings.length === 0) {
      setMessage("Select at least one confirmed booking to cancel.");
      return;
    }

    try {
      setIsCancelling(true);
      for (const bookingId of selectedBookings) {
        const booking = state.bookings.find((item) => item.bookingId === bookingId);
        if (!booking) {
          continue;
        }

        const response = await fetch(`${API_BASE_URL}/cancel-booking`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            bookingId,
            trainId: booking.trainId
          })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "Cancellation failed");
        }
        setMessage(data.upgradedUser
          ? `Booking cancelled. ${data.upgradedUser.username} was upgraded from the waitlist.`
          : "Booking cancelled successfully.");
      }
      setSelectedBookings([]);
      await fetchState();
    } catch (_error) {
      setMessage("Could not cancel selected bookings.");
    } finally {
      setIsCancelling(false);
    }
  }

  async function resetDashboard() {
    try {
      setIsResetting(true);
      const response = await fetch(`${API_BASE_URL}/admin/reset`, {
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Reset failed");
      }
      setSentCount(0);
      setSelectedBookings([]);
      setIsRunning(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setMessage(data.message || "Simulation reset successfully.");
      setState(data.state);
    } catch (_error) {
      setMessage("Could not reset the simulation.");
    } finally {
      setIsResetting(false);
    }
  }

  const showCriticalOverlay = state.criticalFailure && !criticalDismissed;

  return (
    <main className="page-shell">
      {showCriticalOverlay ? (
        <div className="critical-overlay">
          <div className="critical-card">
            <p className="eyebrow">Critical Alert</p>
            <h2>CRITICAL SYSTEM FAILURE</h2>
            <p>No Active Nodes Available.</p>
            <button className="secondary-button critical-button" onClick={() => setCriticalDismissed(true)}>
              Okay
            </button>
          </div>
        </div>
      ) : null}

      <section className="hero-card">
        <div className="hero-topbar">
          <div>
            <p className="eyebrow">Distributed System Simulation</p>
            <h1>Railway Booking Control Center</h1>
            <p className="subtitle">
              VIP priority, per-train waitlists, admin cancellation, and least-load routing are all coordinated live here.
            </p>
          </div>
          <Link className="link-chip" href="/book">
            Open Booking Page
          </Link>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={startSimulation} disabled={isRunning || state.criticalFailure}>
            {isRunning ? "Simulation Running..." : "Start Simulation"}
          </button>
          <button className="secondary-button" onClick={resetDashboard} disabled={isResetting}>
            {isResetting ? "Resetting..." : "Reset Simulation"}
          </button>
          <button className="danger-button" onClick={cancelSelectedBookings} disabled={isCancelling || selectedBookings.length === 0}>
            {isCancelling ? "Cancelling..." : "Cancel Selected"}
          </button>
        </div>
        <div className="stats-grid">
          <article className="stat-card">
            <span>Requests Sent</span>
            <strong>{sentCount}</strong>
          </article>
          <article className="stat-card">
            <span>Total Routed</span>
            <strong>{state.requestCounter}</strong>
          </article>
          <article className="stat-card">
            <span>Pending Bookings</span>
            <strong>{state.totalPendingBookings}</strong>
          </article>
          <article className="stat-card">
            <span>Confirmed Bookings</span>
            <strong>{state.totalSuccessfulBookings}</strong>
          </article>
          <article className="stat-card">
            <span>VIP Successful</span>
            <strong>{state.totalVipSuccessful} / {state.vipSuccessLimit}</strong>
          </article>
          <article className="stat-card">
            <span>Waitlisted</span>
            <strong>{state.totalWaitlistedBookings}</strong>
          </article>
          <article className="stat-card">
            <span>Payment Timeouts</span>
            <strong>{state.totalPaymentTimeouts}</strong>
          </article>
        </div>
        <p className="message-bar">{message}</p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Train Summary</h2>
          <span>Each train has 100 seats: 90 reserved for normal users and 10 reserved for VIP users</span>
        </div>
        <div className="stats-grid">
          {state.trainSummaries.map((train) => (
            <article key={train.trainId} className="stat-card">
              <span>{train.name} | {train.source} to {train.destination}</span>
              <strong>{train.confirmedCount} confirmed</strong>
              <p>Available: {train.availableSeats}</p>
              <p>VIP Confirmed: {train.vipCount} / 10</p>
              <p>Waitlist: {train.waitlistCount}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Server Status</h2>
            <span>Load balancer always chooses the active server with the smallest live load</span>
          </div>
          <div className="server-list">
            {state.servers.map((server) => (
              <article
                key={server.id}
                className={`server-card ${server.status} ${getHighlight(state, server.id) ? "highlight" : ""}`}
              >
                <div className="server-row">
                  <h3>{server.name} - {server.totalProcessedRequests} requests</h3>
                  <span className={`status-pill ${server.status}`}>
                    {server.status === "active" ? "Active" : "Down"}
                  </span>
                </div>
                <p>Load: {server.currentLoad} / {server.capacity}</p>
                <div className="card-actions">
                  <button
                    className="danger-button small-button"
                    onClick={() => updateServer(server.id, "fail")}
                    disabled={busyServerId === server.id || server.status !== "active"}
                  >
                    Fail Server
                  </button>
                  <button
                    className="secondary-button small-button"
                    onClick={() => updateServer(server.id, "recover")}
                    disabled={busyServerId === server.id || server.status === "active"}
                  >
                    Recover Server
                  </button>
                </div>
                <div className="server-activity">
                  <strong>Server Activity</strong>
                  {server.activityLogs?.length ? (
                    <div className="server-activity-list">
                      {server.activityLogs.slice(0, 5).map((log, index) => (
                        <div key={`${server.id}-${log.timestamp}-${index}`} className="server-activity-item">
                          <span>{formatTime(log.timestamp)} | {log.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="server-activity-item empty">No recent server activity.</div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Live Request Logs</h2>
            <span>Shows pending, processing, confirmed, waitlisted, failed, and cancelled events</span>
          </div>
          <div className="log-list">
            {state.requestLogs.length === 0 ? (
              <div className="log-item neutral">No request logs yet.</div>
            ) : (
              state.requestLogs.slice(0, 18).map((log) => (
                <div key={`${log.requestId}-${log.status}-${log.timestamp}`} className={`log-item ${String(log.status).toLowerCase()}`}>
                  <strong>Request {log.requestId}</strong>
                  <span>
                    User: {log.username} | Train: {log.trainId} | Time: {formatTime(log.timestamp)} | {log.serverName}
                  </span>
                  <span>
                    Seat: {log.seatId} | {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Pending Bookings</h2>
            <span>These are waiting for payment and hold the seat for one minute</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Name</th>
                  <th>Train</th>
                  <th>Seat</th>
                  <th>Status</th>
                  <th>VIP</th>
                  <th>Server</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {state.pendingBookings.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="empty-cell">No pending bookings right now.</td>
                  </tr>
                ) : (
                  state.pendingBookings.map((booking) => (
                    <tr key={booking.requestId}>
                      <td>{booking.requestId}</td>
                      <td>{booking.username}</td>
                      <td>{booking.trainId}</td>
                      <td>{booking.seatId ?? "Queue candidate"}</td>
                      <td>{booking.status}</td>
                      <td>{booking.isVIP ? <span className="vip-badge">VIP</span> : "Normal"}</td>
                      <td>{booking.serverName}</td>
                      <td>{formatTime(booking.expiresAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Confirmed Bookings</h2>
            <span>Select any booking and cancel it to trigger automatic waitlist upgrade</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Cancel</th>
                  <th>Booking ID</th>
                  <th>Name</th>
                  <th>Train</th>
                  <th>Seat</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Server</th>
                </tr>
              </thead>
              <tbody>
                {state.bookings.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="empty-cell">No confirmed bookings yet.</td>
                  </tr>
                ) : (
                  state.bookings.map((booking) => (
                    <tr key={booking.bookingId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedBookings.includes(booking.bookingId)}
                          onChange={() => toggleBookingSelection(booking.bookingId)}
                        />
                      </td>
                      <td>{booking.bookingId}</td>
                      <td>{booking.username}</td>
                      <td>{booking.trainId}</td>
                      <td>{booking.seatId}</td>
                      <td>{booking.status}</td>
                      <td>{booking.isVIP ? <span className="vip-badge">VIP</span> : "Normal"}</td>
                      <td>{booking.serverName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel bookings-panel">
        <div className="panel-header">
          <h2>Waitlist Queue</h2>
          <span>VIP queue is processed first, FIFO is preserved inside each queue</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Position</th>
                <th>Name</th>
                <th>Train</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Requested At</th>
              </tr>
            </thead>
            <tbody>
              {state.waitlistQueue.length === 0 ? (
                <tr>
                  <td colSpan="6" className="empty-cell">Waitlist is empty.</td>
                </tr>
              ) : (
                state.waitlistQueue.map((booking) => (
                  <tr key={booking.bookingId}>
                    <td>{booking.queueLabel}</td>
                    <td>{booking.username}</td>
                    <td>{booking.trainId}</td>
                    <td>{booking.status}</td>
                    <td>{booking.isVIP ? <span className="vip-badge">VIP</span> : "Normal"}</td>
                    <td>{formatTime(booking.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

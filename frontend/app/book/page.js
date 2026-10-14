"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";
const TRAINS = [
  { trainId: "TR101", name: "Express 1", source: "Mumbai", destination: "Pune" },
  { trainId: "TR202", name: "Express 2", source: "Delhi", destination: "Jaipur" },
  { trainId: "TR303", name: "Express 3", source: "Surat", destination: "Nagpur" }
];
const SEAT_TYPES = ["1A", "2A", "3A", "SL"];

function findTrainByRoute(source, destination) {
  return TRAINS.find((train) => train.source === source && train.destination === destination) || null;
}

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function BookingPage() {
  const [form, setForm] = useState({
    name: "",
    source: TRAINS[0].source,
    destination: TRAINS[0].destination,
    seatType: "2A",
    numberOfSeats: 1,
    isVIP: false
  });
  const [pendingBookings, setPendingBookings] = useState([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("Fill the form and request a booking.");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [trainSummary, setTrainSummary] = useState(null);
  const [vipStats, setVipStats] = useState({ successful: 0, limit: 30 });
  const selectedTrain = useMemo(
    () => findTrainByRoute(form.source, form.destination),
    [form.source, form.destination]
  );
  const destinationOptions = TRAINS.filter((train) => train.source === form.source).map(
    (train) => train.destination
  );

  const earliestExpiry = useMemo(() => {
    if (pendingBookings.length === 0) {
      return null;
    }

    return pendingBookings.reduce((earliest, booking) => {
      if (!earliest) {
        return booking.expiresAt;
      }
      return new Date(booking.expiresAt) < new Date(earliest) ? booking.expiresAt : earliest;
    }, null);
  }, [pendingBookings]);

  async function fetchTrainSummary() {
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard-state`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const summary = data.trainSummaries?.find(
        (item) => item.source === form.source && item.destination === form.destination
      );
      setTrainSummary(summary || null);
      setVipStats({
        successful: data.totalVipSuccessful ?? 0,
        limit: data.vipSuccessLimit ?? 30
      });
    } catch (_error) {
      setTrainSummary(null);
    }
  }

  useEffect(() => {
    const routeExists = destinationOptions.includes(form.destination);
    if (!routeExists && destinationOptions.length > 0) {
      setForm((current) => ({
        ...current,
        destination: destinationOptions[0]
      }));
    }
  }, [destinationOptions, form.destination]);

  useEffect(() => {
    fetchTrainSummary();
  }, [form.source, form.destination]);

  useEffect(() => {
    if (!earliestExpiry) {
      setSecondsLeft(0);
      return;
    }

    function updateCountdown() {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(earliestExpiry).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
    }

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [earliestExpiry]);

  useEffect(() => {
    if (
      pendingBookings.length > 0 &&
      status === "pending" &&
      earliestExpiry &&
      Date.now() >= new Date(earliestExpiry).getTime()
    ) {
      setPendingBookings([]);
      setStatus("error");
      setMessage("Pending booking expired because payment was not completed in one minute.");
    }
  }, [pendingBookings, status, earliestExpiry]);

  function updateField(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : name === "numberOfSeats" ? Number(value) : value
    }));
  }

  async function requestBooking(event) {
    event.preventDefault();

    if (!selectedTrain) {
      setStatus("error");
      setMessage("No train is available for the selected route.");
      return;
    }

    if (form.numberOfSeats > 4) {
      setStatus("error");
      setMessage("A maximum of 4 seats can be booked in one request.");
      return;
    }

    setStatus("requesting");
    setMessage("Creating pending booking requests and reserving seats or waitlist spots.");

    try {
      const response = await fetch(`${API_BASE_URL}/request-booking`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...form,
          trainId: selectedTrain.trainId
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.reason || "Booking request failed");
      }

      setPendingBookings(data.bookings);
      setStatus("pending");
      setMessage(`${data.bookings.length} request(s) are pending. Complete payment to confirm or join the waitlist.`);
      fetchTrainSummary();
    } catch (error) {
      setPendingBookings([]);
      setStatus("error");
      setMessage(error.message);
    }
  }

  async function processPayment() {
    if (pendingBookings.length === 0) {
      return;
    }

    setStatus("processing");
    setMessage("Processing payment. VIP users will be prioritized, and full trains will move users into the waitlist.");

    try {
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });

      const response = await fetch(`${API_BASE_URL}/process-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          requestIds: pendingBookings.map((booking) => booking.requestId)
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.reason || "Payment processing failed");
      }

      const downgraded = data.bookings.some((booking) => booking.vipNotice);
      const waitlisted = data.bookings.some((booking) => booking.status === "WAITLISTED");

      setStatus("confirmed");
      setPendingBookings([]);
      if (downgraded) {
        setMessage("VIP limit reached. Some VIP requests were treated as normal users.");
      } else if (waitlisted) {
        setMessage("Payment completed. Since seats were full, some users were added to the waitlist.");
      } else {
        setMessage(`${data.bookings.length} booking(s) processed successfully.`);
      }
      fetchTrainSummary();
    } catch (error) {
      setStatus("error");
      setMessage(error.message);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-card booking-shell">
        <div className="hero-topbar">
          <div>
            <p className="eyebrow">Passenger Booking</p>
            <h1>Book Your Train</h1>
            <p className="subtitle">
              Each train reserves 90 seats for normal users and 10 seats for VIP users. If the quota is full, the request moves to the timestamp-based waitlist.
            </p>
          </div>
          <Link className="link-chip" href="/">
            Back to Dashboard
          </Link>
        </div>

        <form className="booking-form" onSubmit={requestBooking}>
          <div className="booking-card booking-train-card">
            <div className="booking-card-header">
              <p className="eyebrow">Section 1</p>
              <h2>Train Details</h2>
            </div>
            {selectedTrain ? (
              <div className="booking-train-summary">
                <div className="booking-route-main">
                  <strong>{selectedTrain.name}</strong>
                  <span>{selectedTrain.source} to {selectedTrain.destination}</span>
                </div>
                <div className="booking-train-metrics">
                  <div className="booking-detail-pill">
                    <span>Route</span>
                    <strong>{selectedTrain.source} → {selectedTrain.destination}</strong>
                  </div>
                  <div className="booking-detail-pill">
                    <span>Seats Available</span>
                    <strong>{trainSummary?.availableSeats ?? "--"}</strong>
                  </div>
                  <div className="booking-detail-pill">
                    <span>VIP Seats Used</span>
                    <strong>{trainSummary?.vipCount ?? 0} / 10</strong>
                  </div>
                </div>
              </div>
            ) : (
              <div className="vip-warning">
                No train is mapped to this source and destination combination.
              </div>
            )}
          </div>

          <div className="booking-card">
            <div className="booking-card-header">
              <p className="eyebrow">Section 2</p>
              <h2>Passenger Details</h2>
            </div>
            <div className="booking-grid">
              <label>
                Name
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={updateField}
                  placeholder="Enter passenger name"
                />
              </label>

              <label>
                Source
                <select name="source" value={form.source} onChange={updateField}>
                  {TRAINS.map((train) => train.source).filter((value, index, list) => list.indexOf(value) === index).map((source) => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
              </label>

              <label>
                Destination
                <select name="destination" value={form.destination} onChange={updateField}>
                  {destinationOptions.map((destination) => (
                    <option key={destination} value={destination}>{destination}</option>
                  ))}
                </select>
              </label>

              <label>
                Journey Date
                <input type="text" value="Today" readOnly />
              </label>
            </div>
          </div>

          <div className="booking-card">
            <div className="booking-card-header">
              <p className="eyebrow">Section 3</p>
              <h2>Booking Options</h2>
            </div>
            <div className="booking-grid booking-grid-compact">
              <label>
                Seat Type
                <select name="seatType" value={form.seatType} onChange={updateField}>
                  {SEAT_TYPES.map((seatType) => (
                    <option key={seatType} value={seatType}>{seatType}</option>
                  ))}
                </select>
              </label>

              <label>
                Number of Seats
                <input
                  type="number"
                  name="numberOfSeats"
                  min="1"
                  max="4"
                  value={form.numberOfSeats}
                  onChange={updateField}
                />
              </label>
            </div>

            <label className={`vip-toggle ${form.isVIP ? "active" : ""}`}>
              <input
                type="checkbox"
                name="isVIP"
                checked={form.isVIP}
                onChange={updateField}
              />
              <span className="vip-toggle-indicator" />
              <span className="vip-toggle-copy">
                <strong>VIP Booking</strong>
                <small>Priority waitlist handling for premium passengers</small>
              </span>
            </label>

            {form.isVIP && (trainSummary?.vipCount ?? 0) >= 10 ? (
              <div className="vip-warning">
                VIP quota is full for this train. You will stay VIP and be placed in the FIFO waitlist.
              </div>
            ) : null}
          </div>

          <div className="booking-card booking-cta-card">
            <div className="booking-card-header center">
              <p className="eyebrow">Section 4</p>
              <h2>Confirm Request</h2>
            </div>
            <p className="payment-copy center-copy">
              This creates pending booking requests for the selected train. Payment confirmation decides confirmed seat or waitlist status.
            </p>
            <button
              className="primary-button booking-main-button"
              type="submit"
              disabled={!form.name.trim() || status === "requesting" || status === "processing" || form.numberOfSeats < 1 || form.numberOfSeats > 4}
            >
              {status === "requesting" ? "Requesting..." : "Book Ticket"}
            </button>
          </div>
        </form>

        {pendingBookings.length > 0 ? (
          <div className="pending-card">
            <p className="payment-title">Step 2: Pending Booking</p>
            <p className="payment-copy">
              {pendingBookings.length} request(s) are pending for {selectedTrain?.name || "the selected train"}. Complete payment within one minute.
            </p>
            <p className="pending-state">Seat Lock Time Left: {formatCountdown(secondsLeft)}</p>
            <div className="server-activity-list">
              {pendingBookings.map((booking) => (
                <div key={booking.requestId} className="server-activity-item">
                  Request {booking.requestId} | {booking.trainName} | {booking.source} to {booking.destination} | {booking.isVIP ? "VIP" : "Normal"} | {booking.seatId ?? "Waitlist candidate"}
                </div>
              ))}
            </div>
            <button className="primary-button" onClick={processPayment} disabled={status === "processing"}>
              {status === "processing" ? "Processing Payment..." : "Process Payment"}
            </button>
          </div>
        ) : null}

        <div className={`result-banner ${status === "error" ? "error" : status === "confirmed" ? "success" : "pending"}`}>
          {message}
        </div>
      </section>
    </main>
  );
}

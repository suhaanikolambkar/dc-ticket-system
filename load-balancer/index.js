require("dotenv").config({
  path: require("path").join(__dirname, ".env")
});
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const { MAX_CAPACITY } = require("../shared/createBackendServer");
const app = express();
const PORT = Number(process.env.PORT || 5000);
const TOTAL_SEATS_PER_TRAIN = 100;
const NORMAL_QUOTA = 90;
const VIP_QUOTA = 10;
const FIRST_SIMULATION_REQUEST_TARGET = 350;
const SECOND_SIMULATION_REQUEST_TARGET = 50;
const SECOND_SIMULATION_VIP_TARGET = 31;
const PENDING_LOCK_MS = 60000;
const REQUEST_LOG_LIMIT = 500;
const BOOKING_LOG_LIMIT = 400;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const TRAINS = [
  { trainId: "TR101", name: "Express 1", source: "Mumbai", destination: "Pune" },
  { trainId: "TR202", name: "Express 2", source: "Delhi", destination: "Jaipur" },
  { trainId: "TR303", name: "Express 3", source: "Surat", destination: "Nagpur" }
];

const SEAT_TYPES = ["1A", "2A", "3A", "SL"];

const SERVER_1_URL = process.env.SERVER1_URL || "http://localhost:5001";
const SERVER_2_URL = process.env.SERVER2_URL || "http://localhost:5002";
const SERVER_3_URL = process.env.SERVER3_URL || "http://localhost:5003";

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;


function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const servers = [
  createServerState("server1", "Server 1", SERVER_1_URL),
  createServerState("server2", "Server 2", SERVER_2_URL),
  createServerState("server3", "Server 3", SERVER_3_URL)
];

const trainStates = new Map(TRAINS.map((train) => [train.trainId, createTrainState(train)]));
const requestLogs = [];
const successfulBookings = [];
const pendingBookings = [];
const pendingBookingMap = new Map();
const SIMULATION_NAMES = buildUniqueSimulationNames();

let requestCounter = 0;
let totalServerFailures = 0;
let totalPaymentTimeouts = 0;
let totalWaitlistedBookings = 0;
let lastTrafficServerId = null;
let lastTrafficAt = null;
let simulationRequestCount = 0;
let simulationVipAssigned = 0;

app.use(cors());
app.use(express.json());

function isSupabaseEnabled() {
  return Boolean(supabase);
}

function getVipSuccessCount() {
  return Array.from(trainStates.values()).reduce((total, trainState) => total + trainState.vipCount, 0);
}

function serializeBookingForDatabase(booking) {
  return {
    booking_id: booking.bookingId,
    request_id: booking.requestId,
    username: booking.username,
    train_id: booking.trainId,
    train_name: booking.trainName,
    source: booking.source,
    destination: booking.destination,
    seat_id: booking.seatId,
    seat_type: booking.seatType,
    status: booking.status,
    is_vip: Boolean(booking.isVIP),
    requested_vip: Boolean(booking.requestedVIP),
    vip_notice: booking.vipNotice ?? null,
    server_id: booking.serverId,
    server_name: booking.serverName,
    timestamp_ms: booking.timestamp,
    created_at_iso: booking.createdAt,
    updated_at: new Date().toISOString()
  };
}

function deserializeBooking(row) {
  const train = findTrainById(row.train_id);
  return {
    bookingId: row.booking_id,
    requestId: row.request_id,
    username: row.username,
    trainId: row.train_id,
    trainName: row.train_name || train?.name || row.train_id,
    source: row.source || train?.source || "Unknown",
    destination: row.destination || train?.destination || "Unknown",
    seatId: row.seat_id,
    seatType: row.seat_type,
    status: row.status === "CONFIRMED" ? "SUCCESS" : row.status,
    isVIP: Boolean(row.is_vip),
    requestedVIP: Boolean(row.requested_vip),
    vipNotice: row.vip_notice ?? null,
    serverId: row.server_id,
    serverName: row.server_name,
    timestamp: Number(row.timestamp_ms || Date.now()),
    createdAt: row.created_at_iso || row.created_at || new Date().toISOString()
  };
}

async function persistVipSuccessCount() {
  if (!isSupabaseEnabled()) {
    return;
  }

  const { error } = await supabase
    .from("meta")
    .upsert({
      key: "vip_success_count",
      value: {
        count: getVipSuccessCount(),
        limit: TRAINS.length * VIP_QUOTA
      },
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.warn("Supabase meta persist failed for vip_success_count:", error.message);
  }
}

async function persistConfirmedBooking(booking) {
  if (!isSupabaseEnabled()) {
    return;
  }

  const { error } = await supabase
    .from("bookings")
    .upsert(serializeBookingForDatabase(booking));

  if (error) {
    console.warn("Supabase booking persist failed:", error.message);
  }
}

async function markConfirmedBookingCancelled(booking) {
  if (!isSupabaseEnabled()) {
    return;
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      status: "CANCELLED",
      updated_at: new Date().toISOString()
    })
    .eq("booking_id", booking.bookingId);

  if (error) {
    console.warn("Supabase booking cancellation persist failed:", error.message);
  }
}

async function persistWaitlistBooking(booking) {
  if (!isSupabaseEnabled()) {
    return;
  }

  const { error } = await supabase
    .from("waitlist")
    .upsert(serializeBookingForDatabase(booking));

  if (error) {
    console.warn("Supabase waitlist persist failed:", error.message);
  }
}

async function removeWaitlistBooking(bookingId) {
  if (!isSupabaseEnabled()) {
    return;
  }

  const { error } = await supabase
    .from("waitlist")
    .delete()
    .eq("booking_id", bookingId);

  if (error) {
    console.warn("Supabase waitlist removal failed:", error.message);
  }
}

async function clearPersistentSimulationState() {
  if (!isSupabaseEnabled()) {
    return;
  }

  const [{ error: waitlistError }, { error: bookingsError }] = await Promise.all([
    supabase.from("waitlist").delete().neq("booking_id", "__never__"),
    supabase.from("bookings").delete().neq("booking_id", "__never__")
  ]);

  if (waitlistError) {
    console.warn("Supabase waitlist reset failed:", waitlistError.message);
  }
  if (bookingsError) {
    console.warn("Supabase bookings reset failed:", bookingsError.message);
  }

  await persistVipSuccessCount();
}

function createServerState(id, name, url) {
  return {
    id,
    name,
    url,
    status: "unknown",
    currentLoad: 0,
    capacity: MAX_CAPACITY,
    totalProcessedRequests: 0,
    activityLogs: []
  };
}

function createTrainState(train) {
  return {
    trainId: train.trainId,
    name: train.name,
    source: train.source,
    destination: train.destination,
    totalSeats: TOTAL_SEATS_PER_TRAIN,
    seatMap: new Map(
      Array.from({ length: TOTAL_SEATS_PER_TRAIN }, (_, index) => {
        const seatNumber = index + 1;
        return [
          `${train.trainId}-S${seatNumber}`,
          {
            seatId: `${train.trainId}-S${seatNumber}`,
            seatType: SEAT_TYPES[index % SEAT_TYPES.length],
            status: "available",
            lockedBy: null
          }
        ];
      })
    ),
    confirmedBookings: [],
    waitlistQueue: [],
    vipCount: 0
  };
}

function resetTrainStates() {
  trainStates.clear();
  for (const train of TRAINS) {
    trainStates.set(train.trainId, createTrainState(train));
  }
}

function buildUniqueSimulationNames() {
  const firstNames = [
    "Aarav", "Aditi", "Aisha", "Akash", "Aman", "Amaya", "Anaya", "Aniket", "Anisha", "Arjun",
    "Bhavya", "Charvi", "Darsh", "Diya", "Eesha", "Farhan", "Gauri", "Harsh", "Ishaan", "Jiya",
    "Kabir", "Kavya", "Krish", "Lavanya", "Mahi", "Manav", "Meera", "Mihir", "Myra", "Naina",
    "Neil", "Niharika", "Om", "Pari", "Pranav", "Rhea", "Rishi", "Saanvi", "Sai", "Samaira",
    "Shaurya", "Siya", "Tanish", "Tara", "Trisha", "Ved", "Vihaan", "Yash", "Zara", "Zoya"
  ];
  const lastNames = [
    "Agarwal", "Bansal", "Chawla", "Deshmukh", "Dubey", "Ghosh", "Iyer", "Jain", "Kapoor", "Kulkarni",
    "Mahajan", "Malhotra", "Menon", "Mishra", "Nair", "Patel", "Rao", "Reddy", "Saxena", "Shah",
    "Sharma", "Singh", "Soni", "Trivedi", "Varma"
  ];

  const names = [];
  for (const firstName of firstNames) {
    for (const lastName of lastNames) {
      names.push(`${firstName} ${lastName}`);
    }
  }

  return names.slice(0, 250);
}

function nextSimulationName() {
  const index = requestCounter % SIMULATION_NAMES.length;
  return SIMULATION_NAMES[index];
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeSeatCount(value) {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

function findTrainById(trainId) {
  return TRAINS.find((train) => train.trainId === trainId) || null;
}

function findTrainByRoute(source, destination) {
  return TRAINS.find((train) => train.source === source && train.destination === destination) || null;
}

function resolveRequestedTrain(input = {}) {
  if (input.source && input.destination) {
    return findTrainByRoute(input.source, input.destination);
  }

  if (input.trainId) {
    return findTrainById(input.trainId);
  }

  return null;
}

function sortByTimestamp(queue) {
  queue.sort((a, b) => a.timestamp - b.timestamp);
}

function pushLog(entry) {
  requestLogs.unshift(entry);
  if (requestLogs.length > REQUEST_LOG_LIMIT) {
    requestLogs.pop();
  }
}

function pushBooking(entry) {
  successfulBookings.unshift(entry);
  if (successfulBookings.length > BOOKING_LOG_LIMIT) {
    successfulBookings.pop();
  }
}

function removePendingBooking(requestId) {
  const index = pendingBookings.findIndex((booking) => booking.requestId === requestId);
  if (index >= 0) {
    pendingBookings.splice(index, 1);
  }
}

function chooseLeastLoad(candidates) {
  if (candidates.length === 0) {
    return null;
  }

  const minLoad = Math.min(...candidates.map((server) => server.currentLoad));
  const leastLoaded = candidates.filter((server) => server.currentLoad === minLoad);
  return randomItem(leastLoaded);
}

function getActiveServers(excludedIds = []) {
  return servers.filter(
    (server) => server.status === "active" && !excludedIds.includes(server.id)
  );
}

function selectServer(excludedIds = []) {
  const activeServers = getActiveServers(excludedIds);
  if (activeServers.length === 0) {
    return null;
  }

  const eligibleServers = activeServers.filter((server) => server.currentLoad < server.capacity);
  return chooseLeastLoad(eligibleServers.length > 0 ? eligibleServers : activeServers);
}

function summarizeServerPayload(server, data) {
  server.status = "active";
  server.currentLoad = data.currentLoad ?? 0;
  server.capacity = data.capacity ?? MAX_CAPACITY;
  server.totalProcessedRequests = data.totalProcessedRequests ?? 0;
  server.activityLogs = data.activityLogs ?? [];
}

async function refreshServer(server) {
  try {
    const response = await fetch(`${server.url}/status`, {
      signal: AbortSignal.timeout(1000)
    });

    if (!response.ok) {
      throw new Error(`Health check failed for ${server.name}`);
    }

    const data = await response.json();
    summarizeServerPayload(server, data);
  } catch (_error) {
    server.status = "down";
    server.currentLoad = 0;
    server.totalProcessedRequests = 0;
    server.activityLogs = [
      {
        type: "DOWN",
        requestId: null,
        username: null,
        seatId: null,
        timestamp: new Date().toISOString(),
        message: `${server.name} is not responding to health checks`
      }
    ];
  }
}

async function refreshAllServers() {
  await Promise.all(servers.map(refreshServer));
}

async function sendServerActivity(server, message, requestId, seatId, username, trainId, isVIP) {
  try {
    await fetch(`${server.url}/admin/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "INFO",
        requestId,
        username,
        seatId,
        trainId,
        isVIP,
        message
      }),
      signal: AbortSignal.timeout(1000)
    });
  } catch (_error) {
    console.warn(`Unable to write activity log to ${server.name}`);
  }
}

async function markServerState(serverId, action) {
  const server = servers.find((item) => item.id === serverId);

  if (!server) {
    return null;
  }

  const response = await fetch(`${server.url}/admin/${action}`, {
    method: "POST",
    signal: AbortSignal.timeout(1000)
  });

  if (!response.ok) {
    throw new Error(`Unable to ${action} ${server.name}`);
  }

  await refreshServer(server);
  return server;
}

async function resetServers() {
  await Promise.all(
    servers.map(async (server) => {
      try {
        await fetch(`${server.url}/admin/reset`, {
          method: "POST",
          signal: AbortSignal.timeout(1000)
        });
      } catch (_error) {
        server.status = "down";
      }
    })
  );

  await refreshAllServers();
}

function getTrainState(trainId) {
  if (!trainStates.has(trainId)) {
    const train = findTrainById(trainId);
    if (!train) {
      return null;
    }
    trainStates.set(trainId, createTrainState(train));
  }

  return trainStates.get(trainId);
}

function findAvailableSeat(trainState, seatType) {
  const exactMatch = Array.from(trainState.seatMap.values()).find(
    (seat) => seat.seatType === seatType && seat.status === "available"
  );

  if (exactMatch) {
    return exactMatch;
  }

  return Array.from(trainState.seatMap.values()).find((seat) => seat.status === "available") || null;
}

function getConfirmedCounts(trainState) {
  const vipConfirmedCount = trainState.confirmedBookings.filter((booking) => booking.isVIP).length;
  return {
    vipConfirmedCount,
    normalConfirmedCount: trainState.confirmedBookings.length - vipConfirmedCount
  };
}

function getQuotaLimit(isVIP) {
  return isVIP ? VIP_QUOTA : NORMAL_QUOTA;
}

function countPendingQuotaReservations(trainId, isVIP) {
  return pendingBookings.filter(
    (booking) =>
      booking.trainId === trainId &&
      booking.status === "PENDING" &&
      Boolean(booking.isVIP) === Boolean(isVIP) &&
      Boolean(booking.seatId)
  ).length;
}

function hasQuotaSpace(trainState, isVIP, options = {}) {
  const counts = getConfirmedCounts(trainState);
  const pendingReserved = options.includePending
    ? countPendingQuotaReservations(trainState.trainId, isVIP)
    : 0;
  const used = isVIP ? counts.vipConfirmedCount : counts.normalConfirmedCount;
  return used + pendingReserved < getQuotaLimit(isVIP);
}

function applyConfirmedBookingToMemory(booking) {
  const trainState = getTrainState(booking.trainId);
  if (!trainState) {
    return;
  }

  if (trainState.confirmedBookings.some((item) => item.bookingId === booking.bookingId)) {
    return;
  }

  booking.status = booking.status === "CONFIRMED" ? "SUCCESS" : booking.status;
  trainState.confirmedBookings.push(booking);
  trainState.vipCount = getConfirmedCounts(trainState).vipConfirmedCount;

  if (booking.seatId) {
    const seat = trainState.seatMap.get(booking.seatId);
    if (seat) {
      seat.status = "booked";
      seat.lockedBy = null;
    }
  }
  pushBooking(booking);
}

function applyWaitlistBookingToMemory(booking) {
  const trainState = getTrainState(booking.trainId);
  if (!trainState) {
    return;
  }

  booking.status = "WAITLISTED";
  booking.seatId = null;

  if (!trainState.waitlistQueue.some((item) => item.bookingId === booking.bookingId)) {
    trainState.waitlistQueue.push(booking);
    sortByTimestamp(trainState.waitlistQueue);
    totalWaitlistedBookings += 1;
  }
}

async function hydratePersistentState() {
  if (!isSupabaseEnabled()) {
    console.warn("Supabase is not configured. Continuing with in-memory booking state.");
    return;
  }

  const [{ data: bookingRows, error: bookingsError }, { data: waitlistRows, error: waitlistError }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select("*")
        .in("status", ["SUCCESS", "CONFIRMED"])
        .order("timestamp_ms", { ascending: true }),
      supabase
        .from("waitlist")
        .select("*")
        .eq("status", "WAITLISTED")
        .order("timestamp_ms", { ascending: true })
    ]);

  if (bookingsError) {
    console.warn("Could not load Supabase bookings:", bookingsError.message);
  }
  if (waitlistError) {
    console.warn("Could not load Supabase waitlist:", waitlistError.message);
  }

  resetTrainStates();
  successfulBookings.length = 0;
  totalWaitlistedBookings = 0;

  for (const row of bookingRows || []) {
    applyConfirmedBookingToMemory(deserializeBooking(row));
  }

  for (const row of waitlistRows || []) {
    applyWaitlistBookingToMemory(deserializeBooking(row));
  }

  const maxRequestId = [...successfulBookings, ...Array.from(trainStates.values()).flatMap(getCombinedWaitlist)]
    .reduce((max, booking) => Math.max(max, Number(booking.requestId || 0)), requestCounter);
  requestCounter = Math.max(requestCounter, maxRequestId);

  await persistVipSuccessCount();
  console.log("Supabase booking state loaded into the load balancer.");
}

function sanitizeBooking(booking) {
  return {
    bookingId: booking.bookingId,
    requestId: booking.requestId,
    username: booking.username,
    trainId: booking.trainId,
    trainName: booking.trainName,
    source: booking.source,
    destination: booking.destination,
    timestamp: booking.timestamp,
    createdAt: booking.createdAt,
    expiresAt: booking.expiresAt ?? null,
    seatId: booking.seatId ?? null,
    seatType: booking.seatType ?? null,
    status: booking.status,
    isVIP: Boolean(booking.isVIP),
    requestedVIP: Boolean(booking.requestedVIP),
    vipNotice: booking.vipNotice ?? null,
    serverId: booking.serverId,
    serverName: booking.serverName
  };
}

function getCombinedWaitlist(trainState) {
  sortByTimestamp(trainState.waitlistQueue);
  return trainState.waitlistQueue.map((booking, index) => ({
    ...sanitizeBooking(booking),
    position: index + 1,
    queueLabel: `WL${index + 1}`
  }));
}

function buildTrainSummaries() {
  return Array.from(trainStates.values()).map((trainState) => ({
    trainId: trainState.trainId,
    name: trainState.name,
    source: trainState.source,
    destination: trainState.destination,
    totalSeats: trainState.totalSeats,
    confirmedCount: trainState.confirmedBookings.length,
    waitlistCount: trainState.waitlistQueue.length,
    vipCount: trainState.vipCount,
    availableSeats: trainState.totalSeats - trainState.confirmedBookings.length
  }));
}

function createSystemState() {
  return {
    requestCounter,
    totalSuccessfulBookings: successfulBookings.length,
    totalVipSuccessful: getVipSuccessCount(),
    vipSuccessLimit: TRAINS.length * VIP_QUOTA,
    totalPendingBookings: pendingBookings.length,
    totalServerFailures,
    totalPaymentTimeouts,
    totalWaitlistedBookings,
    criticalFailure: servers.every((server) => server.status !== "active"),
    lastTrafficServerId,
    lastTrafficAt,
    servers: servers.map((server) => ({
      id: server.id,
      name: server.name,
      status: server.status === "active" ? "active" : "down",
      currentLoad: server.currentLoad,
      capacity: server.capacity,
      totalProcessedRequests: server.totalProcessedRequests,
      activityLogs: server.activityLogs
    })),
    requestLogs,
    trainSummaries: buildTrainSummaries(),
    pendingBookings: pendingBookings.map((booking) => ({
      requestId: booking.requestId,
      bookingId: booking.bookingId,
      username: booking.username,
      trainId: booking.trainId,
      trainName: booking.trainName,
      source: booking.source,
      destination: booking.destination,
      seatId: booking.seatId,
      seatType: booking.seatType,
      status: booking.status,
      serverId: booking.serverId,
      serverName: booking.serverName,
      timestamp: booking.createdAt,
      expiresAt: booking.expiresAt,
      isVIP: Boolean(booking.isVIP)
    })),
    bookings: successfulBookings.map(sanitizeBooking),
    waitlistQueue: Array.from(trainStates.values()).flatMap((trainState) => getCombinedWaitlist(trainState))
  };
}

function generateSimulationPayload() {
  if (simulationRequestCount >= FIRST_SIMULATION_REQUEST_TARGET + SECOND_SIMULATION_REQUEST_TARGET) {
    simulationRequestCount = 0;
    simulationVipAssigned = 0;
  }

  let isVIP = false;
  if (simulationRequestCount >= FIRST_SIMULATION_REQUEST_TARGET) {
    const secondPhaseCount = simulationRequestCount - FIRST_SIMULATION_REQUEST_TARGET;
    const requestsLeft = SECOND_SIMULATION_REQUEST_TARGET - secondPhaseCount;
    const vipLeft = Math.max(0, SECOND_SIMULATION_VIP_TARGET - simulationVipAssigned);
    isVIP = vipLeft > 0 && (
      requestsLeft <= vipLeft || Math.random() < vipLeft / requestsLeft
    );
  }

  simulationRequestCount += 1;
  if (isVIP) {
    simulationVipAssigned += 1;
  }

  const train = randomItem(TRAINS);
  return {
    name: nextSimulationName(),
    trainId: train.trainId,
    source: train.source,
    destination: train.destination,
    seatType: randomItem(SEAT_TYPES),
    numberOfSeats: 1,
    isVIP
  };
}

function expirePendingBooking(requestId) {
  const pending = pendingBookingMap.get(requestId);
  if (!pending || pending.status !== "PENDING") {
    return;
  }

  const trainState = getTrainState(pending.trainId);
  if (pending.seatId && trainState) {
    const seat = trainState.seatMap.get(pending.seatId);
    if (seat && seat.lockedBy === pending.requestId) {
      seat.status = "available";
      seat.lockedBy = null;
    }
  }

  pending.status = "FAILED";
  pending.expiredAt = new Date().toISOString();
  removePendingBooking(requestId);
  pendingBookingMap.delete(requestId);
  totalPaymentTimeouts += 1;

  pushLog({
    requestId: pending.requestId,
    username: pending.username,
    timestamp: pending.expiredAt,
    trainId: pending.trainId,
    seatId: pending.seatId ?? "WAITLIST",
    serverId: pending.serverId,
    serverName: pending.serverName,
    status: "FAILED",
    message: "Pending booking expired because payment was not completed in time"
  });
}

async function createPendingBooking(input) {
  const requestId = ++requestCounter;
  const bookingId = `BK-${requestId}`;
  const username = input.name || input.username || nextSimulationName();
  const requestedTrain = resolveRequestedTrain(input);

  if (!requestedTrain) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        reason: "No train available for the selected source and destination"
      }
    };
  }

  const trainState = getTrainState(requestedTrain.trainId);
  const server = selectServer();
  const seatType = input.seatType || randomItem(SEAT_TYPES);
  const isVIP = Boolean(input.isVIP);
  const timestamp = Date.now();
  const createdAt = new Date(timestamp).toISOString();

  if (!server) {
    totalServerFailures += 1;
    pushLog({
      requestId,
      username,
      timestamp: createdAt,
      trainId: requestedTrain.trainId,
      seatId: "N/A",
      serverId: null,
      serverName: "Unavailable",
      status: "FAILED",
      message: "No active servers available"
    });

    return {
      ok: false,
      status: 503,
      body: {
        success: false,
        requestId,
        reason: "No active servers available"
      }
    };
  }

  const quotaHasSpace = hasQuotaSpace(trainState, isVIP, { includePending: true });
  const availableSeat = quotaHasSpace ? findAvailableSeat(trainState, seatType) : null;
  if (availableSeat) {
    availableSeat.status = "locked";
    availableSeat.lockedBy = requestId;
  }

  const pendingBooking = {
    bookingId,
    requestId,
    username,
    trainId: requestedTrain.trainId,
    trainName: requestedTrain.name,
    source: requestedTrain.source,
    destination: requestedTrain.destination,
    seatType,
    seatId: availableSeat ? availableSeat.seatId : null,
    status: "PENDING",
    serverId: server.id,
    serverName: server.name,
    timestamp,
    createdAt,
    expiresAt: new Date(timestamp + PENDING_LOCK_MS).toISOString(),
    isVIP,
    requestedVIP: isVIP
  };

  pendingBooking.expiryTimer = setTimeout(() => {
    expirePendingBooking(requestId);
  }, PENDING_LOCK_MS);

  pendingBookingMap.set(requestId, pendingBooking);
  pendingBookings.unshift(pendingBooking);

  pushLog({
    requestId,
    username,
    timestamp: createdAt,
    trainId: pendingBooking.trainId,
    seatId: pendingBooking.seatId ?? "WAITLIST",
    serverId: server.id,
    serverName: server.name,
    status: "PENDING",
    message: quotaHasSpace
      ? `${pendingBooking.trainName} requested${isVIP ? " with VIP quota" : " with normal quota"}, awaiting payment`
      : `${pendingBooking.trainName} requested${isVIP ? " with VIP quota" : " with normal quota"}, quota full so it may join waitlist`
  });

  await sendServerActivity(
    server,
    `${server.name} received pending ${isVIP ? "VIP" : "normal"} booking ${requestId} for ${pendingBooking.trainName}`,
    requestId,
    pendingBooking.seatId,
    username,
    pendingBooking.trainId,
    isVIP
  );

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      booking: sanitizeBooking(pendingBooking),
      vipNotice: null
    }
  };
}

async function createPendingBookings(input) {
  const seatCount = normalizeSeatCount(input.numberOfSeats);

  if (seatCount === null || seatCount < 1) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        reason: "Number of seats must be at least 1"
      }
    };
  }

  if (seatCount > 4) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        reason: "A maximum of 4 seats can be booked in one request"
      }
    };
  }

  const bookings = [];

  for (let index = 0; index < seatCount; index += 1) {
    const result = await createPendingBooking({ ...input, numberOfSeats: 1 });
    if (!result.ok) {
      if (bookings.length === 0) {
        return result;
      }
      break;
    }
    bookings.push(result.body.booking);
  }

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      bookings
    }
  };
}

async function dispatchProcess(pending, attempted = []) {
  const preferredServer = servers.find(
    (server) => server.id === pending.serverId && server.status === "active" && !attempted.includes(server.id)
  );
  const server = preferredServer || selectServer(attempted);

  if (!server) {
    throw new Error("No active servers available");
  }

  const params = new URLSearchParams({
    requestId: String(pending.requestId),
    username: pending.username,
    timestamp: pending.createdAt,
    seatId: pending.seatId ?? "WAITLIST",
    trainId: pending.trainId,
    isVIP: String(pending.isVIP)
  });

  server.currentLoad += 1;
  lastTrafficServerId = server.id;
  lastTrafficAt = new Date().toISOString();

  try {
    const response = await fetch(`${server.url}/process?${params.toString()}`, {
      signal: AbortSignal.timeout(7000)
    });

    if (!response.ok) {
      throw new Error(`Processing failed on ${server.name}`);
    }

    await response.json();
    return server;
  } catch (_error) {
    server.currentLoad = Math.max(0, server.currentLoad - 1);
    server.status = "down";
    totalServerFailures += 1;
    return dispatchProcess(pending, [...attempted, server.id]);
  } finally {
    if (server.status === "active") {
      server.currentLoad = Math.max(0, server.currentLoad - 1);
    }
  }
}

async function enqueueWaitlist(trainState, booking) {
  booking.status = "WAITLISTED";
  booking.seatId = null;
  if (!trainState.waitlistQueue.some((item) => item.bookingId === booking.bookingId)) {
    trainState.waitlistQueue.push(booking);
    sortByTimestamp(trainState.waitlistQueue);
    totalWaitlistedBookings += 1;
  }
  await persistWaitlistBooking(booking);
}

async function promoteWaitlistedBooking(trainState, freedSeatId) {
  sortByTimestamp(trainState.waitlistQueue);
  const nextBooking = trainState.waitlistQueue[0];
  if (!nextBooking) {
    return null;
  }

  if (!hasQuotaSpace(trainState, nextBooking.isVIP, { includePending: false })) {
    return null;
  }

  trainState.waitlistQueue.shift();
  totalWaitlistedBookings = Math.max(0, totalWaitlistedBookings - 1);

  const seat = trainState.seatMap.get(freedSeatId) || findAvailableSeat(trainState, nextBooking.seatType);
  if (!seat) {
    await enqueueWaitlist(trainState, nextBooking);
    return null;
  }

  seat.status = "booked";
  seat.lockedBy = null;
  nextBooking.seatId = seat.seatId;
  nextBooking.status = "SUCCESS";
  nextBooking.promotedAt = new Date().toISOString();
  trainState.confirmedBookings.push(nextBooking);
  trainState.vipCount = getConfirmedCounts(trainState).vipConfirmedCount;
  pushBooking(nextBooking);
  await removeWaitlistBooking(nextBooking.bookingId);
  await persistConfirmedBooking(nextBooking);
  await persistVipSuccessCount();

  pushLog({
    requestId: nextBooking.requestId,
    username: nextBooking.username,
    timestamp: nextBooking.promotedAt,
    trainId: nextBooking.trainId,
    seatId: nextBooking.seatId,
    serverId: nextBooking.serverId,
    serverName: nextBooking.serverName,
    status: "SUCCESS",
    message: `${nextBooking.trainName} upgraded from waitlist to confirmed`
  });

  return sanitizeBooking(nextBooking);
}

async function drainWaitlist(trainState) {
  while (trainState.waitlistQueue.length > 0) {
    const nextBooking = trainState.waitlistQueue[0];
    if (!hasQuotaSpace(trainState, nextBooking.isVIP, { includePending: false })) {
      break;
    }
    const seat = findAvailableSeat(trainState, nextBooking.seatType);
    if (!seat) {
      break;
    }
    const promoted = await promoteWaitlistedBooking(trainState, seat.seatId);
    if (!promoted) {
      break;
    }
  }
}

async function processPaymentForBooking(requestId) {
  const pending = pendingBookingMap.get(Number(requestId));

  if (!pending) {
    return {
      ok: false,
      status: 404,
      body: {
        success: false,
        reason: "Pending booking not found"
      }
    };
  }

  if (pending.status !== "PENDING") {
    return {
      ok: false,
      status: 409,
      body: {
        success: false,
        reason: `Booking is already ${pending.status.toLowerCase()}`
      }
    };
  }

  pending.status = "PROCESSING";
  pushLog({
    requestId: pending.requestId,
    username: pending.username,
    timestamp: new Date().toISOString(),
    trainId: pending.trainId,
    seatId: pending.seatId ?? "WAITLIST",
    serverId: pending.serverId,
    serverName: pending.serverName,
    status: "PROCESSING",
    message: "Payment processing started"
  });

  try {
    const processingServer = await dispatchProcess(pending);
    const trainState = getTrainState(pending.trainId);

    clearTimeout(pending.expiryTimer);
    pendingBookingMap.delete(pending.requestId);
    removePendingBooking(pending.requestId);

    let seat = pending.seatId ? trainState.seatMap.get(pending.seatId) : null;
    const quotaAvailable = hasQuotaSpace(trainState, pending.requestedVIP, { includePending: false });

    if (pending.seatId && seat && seat.lockedBy !== pending.requestId) {
      seat = null;
    }

    if (!seat) {
      seat = findAvailableSeat(trainState, pending.seatType);
    }

    const booking = {
      bookingId: pending.bookingId,
      requestId: pending.requestId,
      username: pending.username,
      trainId: pending.trainId,
      trainName: pending.trainName,
      source: pending.source,
      destination: pending.destination,
      seatType: pending.seatType,
      seatId: seat ? seat.seatId : null,
      status: "SUCCESS",
      serverId: processingServer.id,
      serverName: processingServer.name,
      timestamp: pending.timestamp,
      createdAt: pending.createdAt,
      requestedVIP: pending.requestedVIP,
      isVIP: Boolean(pending.requestedVIP),
      vipNotice: null
    };

    if (!quotaAvailable) {
      if (seat && seat.lockedBy === pending.requestId) {
        seat.status = "available";
        seat.lockedBy = null;
      }
      booking.seatId = null;
      booking.vipNotice = booking.isVIP
        ? "VIP quota is full. Added to the FIFO waitlist."
        : "Normal quota is full. Added to the FIFO waitlist.";
      await enqueueWaitlist(trainState, booking);

      if (seat) {
        await promoteWaitlistedBooking(trainState, seat.seatId);
      }

      pushLog({
        requestId: booking.requestId,
        username: booking.username,
        timestamp: new Date().toISOString(),
        trainId: booking.trainId,
        seatId: "WAITLIST",
        serverId: booking.serverId,
        serverName: booking.serverName,
        status: "WAITLISTED",
        message: booking.vipNotice
      });

      return {
        ok: true,
        status: 200,
        body: {
          success: true,
          booking: sanitizeBooking(booking)
        }
      };
    }

    if (seat && trainState.confirmedBookings.length < trainState.totalSeats) {
      seat.status = "booked";
      seat.lockedBy = null;
      trainState.confirmedBookings.push(booking);
      trainState.vipCount = getConfirmedCounts(trainState).vipConfirmedCount;
      pushBooking(booking);
      await persistConfirmedBooking(booking);
      await persistVipSuccessCount();
      await drainWaitlist(trainState);

      pushLog({
        requestId: booking.requestId,
        username: booking.username,
        timestamp: new Date().toISOString(),
        trainId: booking.trainId,
        seatId: booking.seatId,
        serverId: booking.serverId,
        serverName: booking.serverName,
        status: "SUCCESS",
        message: `${booking.trainName} booking confirmed${booking.isVIP ? " as VIP" : ""}`
      });

      return {
        ok: true,
        status: 200,
        body: {
          success: true,
          booking: sanitizeBooking(booking)
        }
      };
    }

    if (seat && seat.lockedBy === pending.requestId) {
      seat.status = "available";
      seat.lockedBy = null;
    }

    await enqueueWaitlist(trainState, booking);
    pushLog({
      requestId: booking.requestId,
      username: booking.username,
      timestamp: new Date().toISOString(),
      trainId: booking.trainId,
      seatId: "WAITLIST",
      serverId: booking.serverId,
      serverName: booking.serverName,
      status: "WAITLISTED",
      message: booking.isVIP
        ? `${booking.trainName} waitlisted because VIP quota is full`
        : `${booking.trainName} waitlisted because normal quota is full`
    });

    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        booking: sanitizeBooking(booking)
      }
    };
  } catch (error) {
    const trainState = getTrainState(pending.trainId);
    if (pending.seatId && trainState) {
      const seat = trainState.seatMap.get(pending.seatId);
      if (seat && seat.lockedBy === pending.requestId) {
        seat.status = "available";
        seat.lockedBy = null;
      }
    }

    clearTimeout(pending.expiryTimer);
    pendingBookingMap.delete(pending.requestId);
    removePendingBooking(pending.requestId);
    pending.status = "FAILED";
    totalServerFailures += 1;

    pushLog({
      requestId: pending.requestId,
      username: pending.username,
      timestamp: new Date().toISOString(),
      trainId: pending.trainId,
      seatId: pending.seatId ?? "WAITLIST",
      serverId: pending.serverId,
      serverName: "Unavailable",
      status: "FAILED",
      message: error.message
    });

    return {
      ok: false,
      status: 503,
      body: {
        success: false,
        reason: error.message
      }
    };
  }
}

async function processPaymentForBookings(requestIds) {
  const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
  const bookings = [];

  for (const requestId of ids) {
    const result = await processPaymentForBooking(requestId);
    if (!result.ok) {
      return result;
    }
    bookings.push(result.body.booking);
  }

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      bookings
    }
  };
}

async function cancelBooking(bookingId, trainId) {
  const trainState = getTrainState(trainId);
  if (!trainState) {
    return {
      ok: false,
      status: 404,
      body: {
        message: "Train not found"
      }
    };
  }

  const index = trainState.confirmedBookings.findIndex((booking) => booking.bookingId === bookingId);
  if (index < 0) {
    return {
      ok: false,
      status: 404,
      body: {
        message: "Booking not found"
      }
    };
  }

  const [removedBooking] = trainState.confirmedBookings.splice(index, 1);
  const successfulIndex = successfulBookings.findIndex((booking) => booking.bookingId === bookingId);
  if (successfulIndex >= 0) {
    successfulBookings.splice(successfulIndex, 1);
  }

  trainState.vipCount = getConfirmedCounts(trainState).vipConfirmedCount;
  removedBooking.status = "CANCELLED";
  removedBooking.cancelledAt = new Date().toISOString();
  await markConfirmedBookingCancelled(removedBooking);
  await persistVipSuccessCount();

  if (removedBooking.seatId) {
    const seat = trainState.seatMap.get(removedBooking.seatId);
    if (seat) {
      seat.status = "available";
      seat.lockedBy = null;
    }
  }

  pushLog({
    requestId: removedBooking.requestId,
    username: removedBooking.username,
    timestamp: new Date().toISOString(),
    trainId: removedBooking.trainId,
    seatId: removedBooking.seatId,
    serverId: removedBooking.serverId,
    serverName: removedBooking.serverName,
    status: "CANCELLED",
    message: `${removedBooking.trainName} booking cancelled by admin`
  });

  await drainWaitlist(trainState);
  const upgradedUser = null;

  return {
    ok: true,
    status: 200,
    body: {
      message: "Booking cancelled",
      upgradedUser
    }
  };
}

app.get("/request", async (_req, res) => {
  const created = await createPendingBookings(generateSimulationPayload());
  if (!created.ok) {
    return res.status(created.status).json(created.body);
  }

  setTimeout(() => {
    processPaymentForBookings(created.body.bookings.map((booking) => booking.requestId)).catch((error) => {
      console.error("Simulation payment processing failed:", error.message);
    });
  }, 250 + Math.floor(Math.random() * 350));

  return res.status(created.status).json(created.body);
});

app.post("/request-booking", async (req, res) => {
  const result = await createPendingBookings(req.body || {});
  return res.status(result.status).json(result.body);
});

app.post("/process-payment", async (req, res) => {
  const result = await processPaymentForBookings(req.body?.requestIds ?? req.body?.requestId);
  return res.status(result.status).json(result.body);
});

app.post("/cancel-booking", async (req, res) => {
  const result = await cancelBooking(req.body?.bookingId, req.body?.trainId);
  return res.status(result.status).json(result.body);
});

app.get("/bookings/:trainId", (req, res) => {
  const trainState = getTrainState(req.params.trainId);
  if (!trainState) {
    return res.status(404).json({ message: "Train not found" });
  }

  return res.json({
    confirmedBookings: trainState.confirmedBookings.map(sanitizeBooking),
    waitlistQueue: getCombinedWaitlist(trainState)
  });
});

app.get("/dashboard-state", async (_req, res) => {
  await refreshAllServers();
  res.json(createSystemState());
});

app.post("/admin/fail/:serverId", async (req, res) => {
  try {
    const server = await markServerState(req.params.serverId, "fail");
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    return res.json({
      message: `${server.name} failed`,
      state: createSystemState()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/admin/recover/:serverId", async (req, res) => {
  try {
    const server = await markServerState(req.params.serverId, "recover");
    if (!server) {
      return res.status(404).json({ error: "Server not found" });
    }

    return res.json({
      message: `${server.name} recovered`,
      state: createSystemState()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/admin/reset", async (_req, res) => {
  requestCounter = 0;
  totalServerFailures = 0;
  totalPaymentTimeouts = 0;
  totalWaitlistedBookings = 0;
  lastTrafficServerId = null;
  lastTrafficAt = null;
  simulationRequestCount = 0;
  simulationVipAssigned = 0;
  requestLogs.length = 0;
  successfulBookings.length = 0;
  pendingBookings.length = 0;

  for (const pending of pendingBookingMap.values()) {
    clearTimeout(pending.expiryTimer);
  }
  pendingBookingMap.clear();
  resetTrainStates();
  await clearPersistentSimulationState();

  await resetServers();

  return res.json({
    message: "Simulation reset successfully",
    state: createSystemState()
  });
});

setInterval(() => {
  refreshAllServers().catch((error) => {
    console.error("Health check error:", error.message);
  });
  for (const trainState of trainStates.values()) {
    if (trainState.waitlistQueue.length > 0) {
      drainWaitlist(trainState).catch((error) => {
        console.error("Waitlist drain error:", error.message);
      });
    }
  }
}, 1500);

(async function startLoadBalancer() {
  await hydratePersistentState();
  await refreshAllServers();
  app.listen(PORT, () => {
    console.log(`Load balancer listening on port ${PORT}`);
    if (isSupabaseEnabled()) {
      console.log("Supabase persistence is enabled for bookings, waitlist, and VIP meta.");
    }
  });
})();

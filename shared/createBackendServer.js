const express = require("express");

const MAX_CAPACITY = 100;

function randomDelay() {
  return 1200 + Math.floor(Math.random() * 900);
}

function createBackendServer({ serverId, serverName, port }) {
  const app = express();
  app.use(express.json());

  let currentLoad = 0;
  let isDown = false;
  let totalProcessedRequests = 0;
  const activityLogs = [];

  function pushActivity(entry) {
    activityLogs.unshift(entry);
    if (activityLogs.length > 20) {
      activityLogs.pop();
    }
  }

  function resetState() {
    currentLoad = 0;
    isDown = false;
    totalProcessedRequests = 0;
    activityLogs.length = 0;
    pushActivity({
      type: "RESET",
      requestId: null,
      username: null,
      seatId: null,
      timestamp: new Date().toISOString(),
      message: `${serverName} reset to a healthy idle state`
    });
    console.log(`[${serverName}] Reset to healthy idle state`);
  }

  app.get("/process", (req, res) => {
    if (isDown) {
      return res.status(503).json({
        error: `${serverName} is down`
      });
    }

    const { requestId, username, timestamp, seatId, trainId, isVIP } = req.query;
    currentLoad += 1;
    const startedAt = new Date().toISOString();

    pushActivity({
      type: "PROCESSING",
      requestId: Number(requestId),
      username,
      seatId,
      timestamp: startedAt,
      message: `${serverName} started processing Request ${requestId}`
    });

    console.log(
      `[${serverName}] Processing Request ${requestId} | User: ${username} | Train: ${trainId} | Seat: ${seatId} | VIP: ${isVIP}`
    );

    setTimeout(() => {
      currentLoad = Math.max(0, currentLoad - 1);
      totalProcessedRequests += 1;
      const completedAt = new Date().toISOString();

      pushActivity({
        type: "COMPLETED",
        requestId: Number(requestId),
        username,
        seatId,
        timestamp: completedAt,
        message: `${serverName} completed Request ${requestId}`
      });

      console.log(
        `[${serverName}] Completed Request ${requestId} | User: ${username} | Train: ${trainId} | Seat: ${seatId} | VIP: ${isVIP}`
      );

      res.json({
        serverId,
        serverName,
        port,
        requestId: Number(requestId),
        username,
        timestamp,
        seatId,
        processedAt: new Date().toISOString()
      });
    }, randomDelay());
  });

  app.get("/status", (_req, res) => {
    if (isDown) {
      return res.status(503).json({
        status: "down",
        serverId,
        serverName,
        currentLoad,
        capacity: MAX_CAPACITY,
        totalProcessedRequests,
        activityLogs
      });
    }

    return res.json({
      status: "alive",
      serverId,
      serverName,
      currentLoad,
      capacity: MAX_CAPACITY,
      totalProcessedRequests,
      activityLogs
    });
  });

  app.post("/admin/fail", (_req, res) => {
    isDown = true;
    pushActivity({
      type: "DOWN",
      requestId: null,
      username: null,
      seatId: null,
      timestamp: new Date().toISOString(),
      message: `${serverName} was marked down`
    });
    console.log(`[${serverName}] Marked as DOWN`);
    res.json({
      message: `${serverName} marked as down`,
      serverId,
      serverName,
      status: "down"
    });
  });

  app.post("/admin/recover", (_req, res) => {
    isDown = false;
    pushActivity({
      type: "RECOVERED",
      requestId: null,
      username: null,
      seatId: null,
      timestamp: new Date().toISOString(),
      message: `${serverName} recovered`
    });
    console.log(`[${serverName}] Recovered`);
    res.json({
      message: `${serverName} recovered`,
      serverId,
      serverName,
      status: "alive"
    });
  });

  app.post("/admin/reset", (_req, res) => {
    resetState();
    res.json({
      message: `${serverName} reset`,
      serverId,
      serverName,
      status: "alive",
      currentLoad
    });
  });

  app.post("/admin/log", (req, res) => {
    const { type, requestId, username, seatId, message } = req.body || {};
    pushActivity({
      type: type || "INFO",
      requestId: requestId ?? null,
      username: username ?? null,
      seatId: seatId ?? null,
      timestamp: new Date().toISOString(),
      message: message || `${serverName} received an activity update`
    });
    res.json({
      message: `${serverName} activity recorded`
    });
  });

  app.listen(port, () => {
    console.log(`${serverName} listening on port ${port}`);
  });
}

module.exports = {
  MAX_CAPACITY,
  createBackendServer
};

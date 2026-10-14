const { createBackendServer } = require("../shared/createBackendServer");

createBackendServer({
  serverId: "server1",
  serverName: "Server 1",
  port: Number(process.env.PORT || 5001)
});

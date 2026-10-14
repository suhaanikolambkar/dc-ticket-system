const { createBackendServer } = require("../shared/createBackendServer");

createBackendServer({
  serverId: "server2",
  serverName: "Server 2",
  port: Number(process.env.PORT || 5002)
});

const { createBackendServer } = require("../shared/createBackendServer");

createBackendServer({
  serverId: "server3",
  serverName: "Server 3",
  port: Number(process.env.PORT || 5003)
});

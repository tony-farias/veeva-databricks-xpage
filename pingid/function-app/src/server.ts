import { loadConfig } from "./config.js";
import { createBrokerApp } from "./app.js";

const config = loadConfig();

createBrokerApp(config).listen(config.port, () => {
  console.log(JSON.stringify({
    event: "broker.started",
    authorizationMode: "service_principal",
    genieAgentId: config.genieAgentId,
    servicePrincipal: config.servicePrincipalClientId,
    identityClaimName: config.identityClaimName,
    port: config.port,
  }));
});

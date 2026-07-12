import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createBackendRuntime } from "./services.js";

const config = loadConfig();
const runtime = createBackendRuntime(config);
const app = createApp({
  services: runtime.services,
  writing: runtime.writing,
  canvas: runtime.canvas,
  identity: runtime.identity,
  auth: runtime.auth,
  allowedOrigins: config.auth.trustedOrigins
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Ghostwriter backend listening on port ${info.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await runtime.close();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

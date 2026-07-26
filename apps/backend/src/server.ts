import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createBackendRuntime } from "./services.js";

const config = loadConfig();
const runtime = createBackendRuntime(config);

if (config.demoSeed.enabled) {
  await runtime.ensureDemoSeed();
  console.log("Demo seed: Harry Potter project ready for demo account.");
}

const app = createApp({
  services: runtime.services,
  writing: runtime.writing,
  captures: runtime.captures,
  captureAttachments: runtime.captureAttachments,
  capturePromotions: runtime.capturePromotions,
  canvas: runtime.canvas,
  reader: runtime.reader,
  identity: runtime.identity,
  agentProvider: runtime.agentProvider,
  auth: runtime.auth,
  allowedOrigins: config.auth.trustedOrigins,
  objectStorage: runtime.objectStorage,
  demoSeed: config.demoSeed
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

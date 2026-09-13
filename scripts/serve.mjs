import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import next from "next";
import { createApi } from "../apps/api/dist/runtime.js";
import { registerFrontend } from "./frontend-proxy.mjs";

process.env.NODE_ENV = "production";
process.env.SERVE_FRONTEND = "true";
const { app, settings } = await createApi();
const frontendServer = createServer();
const frontend = next({ dev: false, dir: fileURLToPath(new URL("../frontend/", import.meta.url)), httpServer: frontendServer });
try {
  await frontend.prepare();
  const handle = frontend.getRequestHandler();
  frontendServer.on("request", (request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  // The OS selects an unused private port; only Fastify's port is public.
  frontendServer.listen(0, "127.0.0.1");
  await once(frontendServer, "listening");
  registerFrontend(app, `http://127.0.0.1:${frontendServer.address().port}`);
  app.addHook("onClose", async () => {
    await new Promise((resolve, reject) => frontendServer.close((error) => error ? reject(error) : resolve()));
    await frontend.close();
  });
  await app.jobs.run();
  const address = await app.listen({ host: process.env.HOST || "0.0.0.0", port: settings.port });
  console.log(`Chartroom frontend and API listening at ${address}`);
} catch (error) {
  await app.close();
  frontendServer.close();
  await frontend.close();
  throw error;
}

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });

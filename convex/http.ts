import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import {
  finalizeUploadFromApp,
  finalizeUploadOptions,
  uploadFromApp,
  uploadFromAppOptions,
} from "./media";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

/**
 * Health check endpoint
 * GET /api/health
 */
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }),
});

http.route({
  path: "/media/upload",
  method: "OPTIONS",
  handler: uploadFromAppOptions,
});

http.route({
  path: "/media/upload",
  method: "POST",
  handler: uploadFromApp,
});

http.route({
  path: "/media/finalize",
  method: "OPTIONS",
  handler: finalizeUploadOptions,
});

http.route({
  path: "/media/finalize",
  method: "POST",
  handler: finalizeUploadFromApp,
});

export default http;


import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";
import presence from "@convex-dev/presence/convex.config";

const app = defineApp();
app.use(rateLimiter);
app.use(betterAuth);
app.use(presence);

export default app;


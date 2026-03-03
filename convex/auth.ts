import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { betterAuth } from "better-auth/minimal";
import authConfig from "./auth.config";

declare const process: {
  env: Record<string, string | undefined>;
};

const siteUrls = [process.env.SITE_URL, process.env.VITE_SITE_URL]
  .filter((value): value is string => !!value)
  .flatMap((value) => value.split(",").map((url) => url.trim()))
  .filter((value) => value.length > 0);

const trustedOrigins =
  siteUrls.length > 0 ? siteUrls : ["http://localhost:5173"];

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    trustedOrigins,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days - stay logged in
      updateAge: 60 * 60 * 24, // Refresh session daily when user is active
    },
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    plugins: [
      crossDomain({ siteUrl: trustedOrigins[0] }),
      convex({ authConfig }),
    ],
  });


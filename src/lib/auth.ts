import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: `${env.NEXT_PUBLIC_APP_URL}/api/auth`,
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
  },
});

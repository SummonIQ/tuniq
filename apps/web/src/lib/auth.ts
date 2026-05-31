import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { getPrisma } from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(getPrisma(), {
    provider: "postgresql"
  }),
  emailAndPassword: {
    enabled: true
  },
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? "http://localhost:10180",
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:10180"
  ],
  experimental: {
    joins: true
  },
  plugins: [nextCookies()]
});

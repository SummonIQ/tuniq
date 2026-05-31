"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDomain, createRoute } from "./dashboard";

const minLocalPort = 10000;

const domainSchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .regex(/^[a-z0-9.-]+$/),
  kind: z.enum(["TUNIQ_SUBDOMAIN", "CUSTOM"])
});

const routeSchema = z.object({
  domainId: z.string().min(1),
  agentId: z.string().optional(),
  pathPrefix: z.string().trim().min(1).default("/"),
  targetPort: z.coerce.number().int().min(minLocalPort).max(65535)
});

export async function createDomainAction(formData: FormData) {
  const parsed = domainSchema.parse({
    host: formData.get("host"),
    kind: formData.get("kind")
  });

  await createDomain(parsed.host, parsed.kind);
  revalidatePath("/dashboard");
}

export async function createRouteAction(formData: FormData) {
  const parsed = routeSchema.parse({
    domainId: formData.get("domainId"),
    agentId: formData.get("agentId") || undefined,
    pathPrefix: formData.get("pathPrefix") || "/",
    targetPort: formData.get("targetPort")
  });

  await createRoute(parsed);
  revalidatePath("/dashboard");
}

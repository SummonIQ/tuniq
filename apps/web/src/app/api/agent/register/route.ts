import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma, hasDatabaseUrl } from "@/lib/prisma";
import { createRelayToken, createSecret, hashSecret } from "@/lib/security";

const registerSchema = z.object({
  enrollmentToken: z.string().min(12),
  platform: z.string().max(80).optional(),
  version: z.string().max(40).optional()
});

function getRelayUrl() {
  if (!process.env.TUNIQ_RELAY_URL) {
    throw new Error("TUNIQ_RELAY_URL is required");
  }

  return process.env.TUNIQ_RELAY_URL;
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is required to register agents" },
      { status: 503 }
    );
  }

  const body = registerSchema.parse(await request.json());
  const prisma = getPrisma();
  const agent = await prisma.agent.findFirst({
    where: {
      enrollmentTokenHash: hashSecret(body.enrollmentToken),
      enrollmentTokenExpiry: {
        gt: new Date()
      }
    }
  });

  if (!agent) {
    return NextResponse.json({ error: "Invalid enrollment token" }, { status: 401 });
  }

  const agentToken = createSecret("agent");
  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: {
      tokenHash: hashSecret(agentToken),
      enrollmentTokenHash: null,
      enrollmentTokenExpiry: null,
      platform: body.platform,
      version: body.version,
      lastSeenAt: new Date()
    },
    select: {
      id: true,
      name: true
    }
  });

  return NextResponse.json({
    agentId: updated.id,
    agentName: updated.name,
    agentToken,
    relayToken: createRelayToken(updated.id),
    relayUrl: getRelayUrl()
  });
}

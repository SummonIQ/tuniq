import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma, hasDatabaseUrl } from "@/lib/prisma";
import { hashSecret } from "@/lib/security";

const heartbeatSchema = z.object({
  agentId: z.string().min(1),
  agentToken: z.string().min(12),
  version: z.string().max(40).optional()
});

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is required for agent heartbeat" },
      { status: 503 }
    );
  }

  const body = heartbeatSchema.parse(await request.json());
  const prisma = getPrisma();
  const agent = await prisma.agent.findUnique({
    where: { id: body.agentId },
    select: { tokenHash: true }
  });

  if (!agent?.tokenHash || agent.tokenHash !== hashSecret(body.agentToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.agent.update({
    where: { id: body.agentId },
    data: {
      version: body.version,
      lastSeenAt: new Date()
    }
  });

  return NextResponse.json({ ok: true });
}

import { getPrisma } from "@/lib/prisma";

type AuditMetadata = Record<string, unknown>;

export async function logAudit(
  actorId: string | null,
  action: string,
  metadata: AuditMetadata = {},
) {
  const prisma = getPrisma();

  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      metadata: metadata as never,
    },
  });
}

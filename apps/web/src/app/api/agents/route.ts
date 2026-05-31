import { NextResponse } from "next/server";
import { z } from "zod";
import { createAgent } from "@/lib/dashboard";

const createAgentSchema = z.object({
  name: z.string().trim().min(2).max(80)
});

export async function POST(request: Request) {
  const body = createAgentSchema.parse(await request.json());
  const enrollment = await createAgent(body.name);

  return NextResponse.json(enrollment, { status: 201 });
}

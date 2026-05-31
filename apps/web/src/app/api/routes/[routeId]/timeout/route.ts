import { NextResponse } from "next/server";
import { z } from "zod";
import { updateRouteTimeout } from "@/lib/dashboard";
import { isBillingRequiredError } from "@/lib/plan";

const timeoutSchema = z.object({
  timeoutMs: z.number().int().min(5_000).max(600_000)
});

type RouteContext = {
  params: Promise<{
    routeId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { routeId } = await context.params;
    const body = timeoutSchema.parse(await request.json());
    const result = await updateRouteTimeout(routeId, body.timeoutMs);

    return NextResponse.json(result);
  } catch (error) {
    if (isBillingRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    throw error;
  }
}

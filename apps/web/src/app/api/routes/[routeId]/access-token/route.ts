import { NextResponse } from "next/server";
import { clearRouteAccessToken, setRouteAccessToken } from "@/lib/dashboard";
import { isBillingRequiredError } from "@/lib/plan";

type RouteContext = {
  params: Promise<{
    routeId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { routeId } = await context.params;
    const access = await setRouteAccessToken(routeId);

    return NextResponse.json(access);
  } catch (error) {
    if (isBillingRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { routeId } = await context.params;
  const result = await clearRouteAccessToken(routeId);

  return NextResponse.json(result);
}

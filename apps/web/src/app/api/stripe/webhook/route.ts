import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { logAudit } from "@/lib/audit";
import { getPrisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is required" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const prisma = getPrisma();

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

      if (userId && session.customer && subscriptionId) {
        const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
        await prisma.user.update({
          where: { id: userId },
          data: {
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : session.customer.id,
            stripeSubscriptionId: subscription.id,
            stripePriceId: subscription.items.data[0]?.price.id,
            stripeStatus: subscription.status
          }
        });
        await logAudit(userId, "billing.checkout.completed", {
          stripeSessionId: session.id,
          stripeSubscriptionId: subscription.id,
          stripeStatus: subscription.status
        });
      }
    } else {
      const subscription = event.data.object;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;

      const updatedUsers = await prisma.user.findMany({
        where: { stripeCustomerId: customerId },
        select: { id: true }
      });

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          stripeSubscriptionId: subscription.id,
          stripePriceId: subscription.items.data[0]?.price.id,
          stripeStatus: subscription.status
        }
      });

      await Promise.all(
        updatedUsers.map((user) =>
          logAudit(
            user.id,
            event.type === "customer.subscription.deleted"
              ? "billing.subscription.deleted"
              : "billing.subscription.updated",
            {
              stripeSubscriptionId: subscription.id,
              stripeStatus: subscription.status
            },
          ),
        ),
      );
    }
  }

  return NextResponse.json({ received: true });
}

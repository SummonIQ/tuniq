"use server";

import { redirect } from "next/navigation";
import { logAudit } from "./audit";
import { getPrisma } from "./prisma";
import { requireCurrentUser } from "./session";
import { getAppUrl, getProPriceId, getStripe } from "./stripe";

export async function createCheckoutSessionAction() {
  const user = await requireCurrentUser();
  const stripe = getStripe();
  const appUrl = getAppUrl();

  const customerId =
    user.stripeCustomerId ??
    (
      await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user.id
        }
      })
    ).id;

  if (!user.stripeCustomerId) {
    await getPrisma().user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId }
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: getProPriceId(),
        quantity: 1
      }
    ],
    success_url: `${appUrl}/dashboard?billing=success`,
    cancel_url: `${appUrl}/dashboard?billing=cancelled`,
    client_reference_id: user.id,
    subscription_data: {
      metadata: {
        userId: user.id
      }
    }
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  await logAudit(user.id, "billing.checkout.started", {
    stripeSessionId: session.id,
    stripeCustomerId: customerId
  });

  redirect(session.url);
}

export async function createCustomerPortalSessionAction() {
  const user = await requireCurrentUser();

  if (!user.stripeCustomerId) {
    throw new Error("No Stripe customer exists for this user");
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${getAppUrl()}/dashboard`
  });

  await logAudit(user.id, "billing.portal.opened", {
    stripeCustomerId: user.stripeCustomerId
  });

  redirect(session.url);
}

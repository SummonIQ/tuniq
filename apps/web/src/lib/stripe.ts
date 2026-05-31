import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }

  stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-04-22.dahlia",
    typescript: true
  });

  return stripe;
}

export function getAppUrl() {
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    throw new Error("NEXT_PUBLIC_APP_URL is required");
  }

  return process.env.NEXT_PUBLIC_APP_URL;
}

export function getProPriceId() {
  if (!process.env.STRIPE_PRO_PRICE_ID) {
    throw new Error("STRIPE_PRO_PRICE_ID is required");
  }

  return process.env.STRIPE_PRO_PRICE_ID;
}

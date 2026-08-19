import "server-only";
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

// Real Stripe integration, per the user's explicit choice. STRIPE_SECRET_KEY
// is intentionally left blank in .env.example — populate it with a live or
// test-mode secret key before charging real cards. Wallet code that doesn't
// touch Stripe (bank transfer, ledger reads) works without this key.
export const stripe = secretKey ? new Stripe(secretKey) : null;

export function requireStripe() {
  if (!stripe) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Add a Stripe secret key to .env before using card payments.",
    );
  }
  return stripe;
}

export function teeYenPerUnit() {
  return Number(process.env.TEE_YEN_PER_UNIT ?? "100");
}

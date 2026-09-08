import type Stripe from "stripe";
import { requireStripe } from "@/lib/stripe";
import { confirmStripeCharge, markStripeChargeFailed } from "@/lib/domain/teeWallet";
import {
  confirmSubscriptionCheckout,
  markSubscriptionCheckoutFailed,
  handleSubscriptionLifecycleEvent,
} from "@/lib/domain/subscriptions";

function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status): "ACTIVE" | "PAST_DUE" | "CANCELED" {
  switch (status) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return "PAST_DUE";
    case "canceled":
    case "paused":
      return "CANCELED";
    default:
      return "PAST_DUE";
  }
}

export async function POST(request: Request) {
  const stripe = requireStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("missing signature", { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        const stripeSubscriptionId =
          typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
        await confirmSubscriptionCheckout(session.id, stripeSubscriptionId);
      } else if (session.payment_status === "paid") {
        await confirmStripeCharge(session.id);
      }
      break;
    }
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") {
        await markSubscriptionCheckoutFailed(session.id);
      } else {
        await markStripeChargeFailed(session.id);
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionLifecycleEvent(subscription.id, mapStripeSubscriptionStatus(subscription.status));
      break;
    }
    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

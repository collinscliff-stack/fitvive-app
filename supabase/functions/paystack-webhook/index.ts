// Fitvive: receives payment notices from Paystack (first payments and automatic renewals).
// In Paystack > Settings > API Keys & Webhooks, set the Webhook URL to this function's address.
// This function must be deployed with "Verify JWT" switched OFF, because Paystack calls it without a login.
// Secrets needed: PAYSTACK_SECRET_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

async function hmacSha512Hex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return new Response("not configured", { status: 500 });

  const raw = await req.text();
  const expected = await hmacSha512Hex(secret, raw);
  if (!safeEqual(expected, req.headers.get("x-paystack-signature") ?? "")) return new Response("bad signature", { status: 401 });

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("bad body", { status: 400 }); }

  if (event?.event === "charge.success" && event.data?.status === "success") {
    const asService = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await asService.rpc("apply_payment", {
      p_reference: event.data.reference,
      p_amount: event.data.amount,
      p_email: event.data.customer?.email ?? "",
      p_plan_code: event.data.plan?.plan_code ?? null,
    });
    // A 500 makes Paystack try again later.
    if (error) return new Response(error.message, { status: 500 });
  }
  return new Response("ok");
});

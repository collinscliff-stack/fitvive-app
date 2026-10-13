// Fitvive: confirms a Paystack payment when the member returns to the app, then switches their access on.
// Secrets needed: PAYSTACK_SECRET_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) return json({ error: "Payments are not set up yet." });
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Log in first" });

    const { reference } = await req.json().catch(() => ({}));
    if (!reference || !/^[A-Za-z0-9_.=-]{6,100}$/.test(reference)) return json({ error: "Missing payment reference" });

    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.status) return json({ error: out.message || "Paystack could not confirm the payment" });
    if (out.data.status !== "success") return json({ error: `Payment ${out.data.status}. You have not been charged for access.` });

    const asService = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: result, error } = await asService.rpc("apply_payment", {
      p_reference: out.data.reference,
      p_amount: out.data.amount,
      p_email: out.data.customer?.email ?? "",
      p_plan_code: out.data.plan_object?.plan_code ?? (typeof out.data.plan === "string" ? out.data.plan : null),
    });
    if (error) return json({ error: error.message });
    if (result === "underpaid") return json({ error: "The amount paid is less than the fee. Contact the club." });
    return json({ ok: true, result });
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong" });
  }
});

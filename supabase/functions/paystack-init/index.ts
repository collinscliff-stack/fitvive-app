// Fitvive: starts a Paystack payment for a membership or for company seats.
// Secrets needed: PAYSTACK_SECRET_KEY. Optional: SITE_URL (your live address, used as the return page).
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
    if (!secret) return json({ error: "Payments are not set up yet. Add PAYSTACK_SECRET_KEY to the function secrets." });

    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const asService = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await asUser.auth.getUser();
    if (!user || !user.email) return json({ error: "Log in first" });

    const body = await req.json().catch(() => ({}));
    const period = body.plan === "yearly" ? "yearly" : "monthly";
    const isCompany = body.kind === "company";

    const { data: profile } = await asService.from("profiles").select("status,role").eq("id", user.id).single();
    if (!profile || profile.status !== "approved") return json({ error: "Your account must be approved before you can pay" });

    const planKey = isCompany ? `company_seat_${period}` : period;
    const { data: plan } = await asService.from("plans").select("*").eq("key", planKey).single();
    if (!plan || plan.amount_kobo <= 0) return json({ error: "Fees are not set yet. Ask the club admin." });

    let seats = 1;
    let companyId: string | null = null;
    if (isCompany) {
      const { data: company } = await asService.from("companies").select("id").eq("admin_id", user.id).maybeSingle();
      if (!company) return json({ error: "You do not manage a company" });
      companyId = company.id;
      seats = Math.floor(Number(body.seats));
      if (!Number.isFinite(seats) || seats < 1 || seats > 5000) return json({ error: "Enter how many seats you need" });
    }

    let amount = plan.amount_kobo * seats;
    let code: string | null = null;
    if (!isCompany && body.code) {
      const wanted = String(body.code).trim().toUpperCase();
      const { data: dc } = await asService.from("discount_codes").select("*").eq("code", wanted).maybeSingle();
      if (!dc || !dc.active || dc.used >= dc.max_uses) return json({ error: "That code is not valid" });
      code = dc.code;
      amount = Math.round((amount * (100 - dc.percent_off)) / 100);
    }

    const reference = `fv_${crypto.randomUUID().replaceAll("-", "")}`;
    const site = Deno.env.get("SITE_URL") || String(body.returnUrl || "");
    const payload: Record<string, unknown> = {
      email: user.email,
      amount,
      reference,
      currency: "NGN",
      metadata: { user_id: user.id, kind: isCompany ? "company" : "member", plan_key: planKey, seats },
    };
    if (site.startsWith("http")) payload.callback_url = site;
    // A Paystack plan code turns the payment into an auto-renewing subscription. Not used with a discount code.
    if (!isCompany && !code && plan.paystack_plan_code) payload.plan = plan.paystack_plan_code;

    // A 100% code needs no payment.
    if (amount <= 0) {
      await asService.from("payments").insert({ reference, user_id: user.id, kind: "member", plan_key: planKey, amount_kobo: 0, discount_code: code });
      await asService.rpc("apply_payment", { p_reference: reference, p_amount: 0, p_email: user.email, p_plan_code: null });
      return json({ free: true });
    }

    const { error: payErr } = await asService.from("payments").insert({
      reference, user_id: user.id, company_id: companyId, kind: isCompany ? "company" : "member",
      plan_key: planKey, amount_kobo: amount, seats, discount_code: code,
    });
    if (payErr) return json({ error: payErr.message });

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.status) return json({ error: out.message || "Paystack could not start the payment" });
    return json({ url: out.data.authorization_url, reference });
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong" });
  }
});

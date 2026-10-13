// Fitvive: issues a pass for a live room.
// Checks the member in the database, places them in a room of the session, then asks Daily for a token.
// Secrets needed: DAILY_API_KEY. (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Expected problems are returned as { error } with status 200 so the app can show the message.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DAILY = "https://api.daily.co/v1";

async function daily(key: string, path: string, init?: RequestInit) {
  const res = await fetch(DAILY + path, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function ensureRoom(key: string, name: string, exp: number) {
  const found = await daily(key, `/rooms/${name}`);
  if (found.ok) return found.body;
  const made = await daily(key, "/rooms", {
    method: "POST",
    body: JSON.stringify({
      name,
      privacy: "private",
      properties: { exp, eject_at_room_exp: true, enable_prejoin_ui: false, enable_chat: false, enable_knocking: false },
    }),
  });
  if (!made.ok) throw new Error(made.body?.info || made.body?.error || "Could not create the video room");
  return made.body;
}

async function meetingToken(key: string, properties: Record<string, unknown>) {
  const res = await daily(key, "/meeting-tokens", { method: "POST", body: JSON.stringify({ properties }) });
  if (!res.ok) throw new Error(res.body?.info || res.body?.error || "Could not create the room pass");
  return res.body.token as string;
}

const shortName = (full: string) => {
  const p = (full || "").trim().split(/\s+/);
  return (p[0] || "Member") + (p[1] ? ` ${p[1][0].toUpperCase()}.` : "");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("DAILY_API_KEY");
    if (!key) return json({ error: "Video is not set up yet. Add DAILY_API_KEY to the function secrets." });

    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const asService = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Log in first" });

    const body = await req.json().catch(() => ({}));
    const { data: profile } = await asService.from("profiles").select("full_name,status").eq("id", user.id).single();
    if (!profile || profile.status !== "approved") return json({ error: "Your account is not approved" });
    const now = Math.floor(Date.now() / 1000);

    // ---- a trainer-led session: rooms of six, one trainer shown in every room
    if (body.kind === "session") {
      const { data: joined, error } = await asUser.rpc("join_session", { p_session: body.sessionId });
      if (error) return json({ error: error.message });
      const { data: s } = await asService.from("sessions").select("id,starts_at,duration_min,trainer_id").eq("id", body.sessionId).single();
      if (!s) return json({ error: "Session not found" });
      const end = Math.floor(new Date(s.starts_at).getTime() / 1000) + s.duration_min * 60;
      const exp = Math.max(end, now) + 30 * 60;
      const roomName = `fv-s-${s.id}`;
      const room = await ensureRoom(key, roomName, exp);
      const token = await meetingToken(key, {
        room_name: roomName,
        user_id: user.id,
        user_name: shortName(profile.full_name),
        is_owner: !!joined.is_host,
        start_audio_off: s.trainer_id !== user.id,
        exp,
      });
      return json({ url: room.url, token, roomNo: joined.room_no, isHost: !!joined.is_host, isTrainer: s.trainer_id === user.id });
    }

    // ---- a one-to-one workout between two partners
    if (body.kind === "partner") {
      const { data: access } = await asService.rpc("has_access", { p_user: user.id });
      if (!access) return json({ error: "NO_ACCESS" });

      if (body.callId) {
        const { data: call } = await asUser.from("partner_calls").select("*").eq("id", body.callId).maybeSingle();
        if (!call) return json({ error: "This workout invite was not found" });
        if (new Date(call.expires_at).getTime() < Date.now()) return json({ error: "This workout invite has expired" });
        const exp = Math.floor(new Date(call.expires_at).getTime() / 1000);
        const token = await meetingToken(key, { room_name: call.room_name, user_id: user.id, user_name: shortName(profile.full_name), exp });
        return json({ url: call.room_url, token, callId: call.id });
      }

      const { data: pt } = await asUser.from("partnerships").select("*").eq("id", body.partnershipId).eq("status", "accepted").maybeSingle();
      if (!pt) return json({ error: "You are not partners with this member" });
      const other = pt.a === user.id ? pt.b : pt.a;
      const exp = now + 60 * 60;
      const roomName = `fv-p-${crypto.randomUUID()}`;
      const room = await ensureRoom(key, roomName, exp);
      const { data: call, error } = await asService.from("partner_calls").insert({
        partnership_id: pt.id, from_id: user.id, to_id: other, room_name: roomName, room_url: room.url,
        expires_at: new Date(exp * 1000).toISOString(),
      }).select().single();
      if (error) return json({ error: error.message });
      const token = await meetingToken(key, { room_name: roomName, user_id: user.id, user_name: shortName(profile.full_name), exp });
      return json({ url: room.url, token, callId: call.id });
    }

    return json({ error: "Unknown request" });
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong" });
  }
});

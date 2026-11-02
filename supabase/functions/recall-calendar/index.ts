// Reads a published calendar (an .ics link) for a signed-in RECALL user. The webview can't: calendar hosts send no CORS headers.
// Only a few calendar hosts are allowed, and every redirect is checked against the same list, so this can't be pointed at anything else.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const HOSTS = /(^|\.)(outlook\.office365\.com|outlook\.live\.com|outlook\.office\.com|calendar\.google\.com|icloud\.com)$/;
const MAX_BYTES = 5_000_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // The anon key alone passes the platform's token check; a real user token is what proves someone signed in.
  const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { authorization: req.headers.get("authorization") ?? "", apikey: req.headers.get("apikey") ?? "" },
  });
  if (!who.ok) return json({ error: "Sign in first." }, 401);

  const { url } = await req.json().catch(() => ({}));
  let next: URL;
  try { next = new URL(String(url).replace(/^webcal:/i, "https:")); } catch { return json({ error: "That isn’t a link." }, 400); }

  for (let hop = 0; hop < 4; hop++) {
    if (next.protocol !== "https:" || next.port || !HOSTS.test(next.hostname)) return json({ error: "That calendar host isn’t supported." }, 400);
    const res = await fetch(next, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { accept: "text/calendar, text/plain, */*" } });
    const to = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && to) { next = new URL(to, next); continue; }
    if (!res.ok) return json({ error: "The calendar host refused that link." }, 502);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return json({ error: "That calendar is too large." }, 422);
    const ics = await res.text();
    if (ics.length > MAX_BYTES || !ics.includes("BEGIN:VCALENDAR")) return json({ error: "That link isn’t a calendar." }, 422);
    return json({ ics });
  }
  return json({ error: "That link redirects too many times." }, 502);
});

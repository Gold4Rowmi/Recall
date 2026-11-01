// The webview needs CORS and the ClickUp functions predate it. This forwards to them untouched; the caller's own token still authorises everything.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const ALLOWED = new Set(["clickup-sync", "clickup-connect"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const { fn, body } = await req.json().catch(() => ({}));
  if (!ALLOWED.has(fn)) return new Response(JSON.stringify({ error: "Unknown function" }), { status: 400, headers: CORS });
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      authorization: req.headers.get("authorization") ?? "",
      apikey: req.headers.get("apikey") ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  return new Response(res.body, { status: res.status, headers: { ...CORS, "content-type": "application/json" } });
});

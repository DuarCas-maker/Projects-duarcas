// Explicit preload used only by check-auth-http.mjs. Never copied to the runner.
// All credentials, users and upstream data here are synthetic.
if (process.env.PROJECT_OS_AUTH_FIXTURE !== "synthetic-only") throw new Error("This preload is only for the isolated auth test");
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const address = new URL(String(url));
  if (address.hostname !== "supabase.fixture.test") {
    if (["127.0.0.1", "localhost"].includes(address.hostname)) return realFetch(url, init);
    throw new Error("Live upstream calls are forbidden by the fixture");
  }
  const headers = new Headers(init.headers);
  const user = { id: "12345678-1234-1234-1234-123456789012", email: "owner@fixture.test", email_confirmed_at: "2026-01-01", is_anonymous: false };
  if (address.pathname.endsWith("/token")) {
    const body = JSON.parse(init.body);
    if (body.password !== "synthetic-password" && body.refresh_token !== "refresh-fixture") return Response.json({}, { status: 400 });
    return Response.json({ access_token: "access-fixture", refresh_token: "refresh-fixture", expires_in: 3600 });
  }
  if (address.pathname.endsWith("/user")) return headers.get("authorization") === "Bearer access-fixture" ? Response.json(user) : Response.json({}, { status: 401 });
  if (address.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
  if (address.pathname === "/rest/v1/workspace_bootstrap") return Response.json([{ user_id: "existing-workspace" }]);
  if (address.pathname.startsWith("/rest/v1/")) return Response.json([]);
  throw new Error("Unexpected fixture request");
};

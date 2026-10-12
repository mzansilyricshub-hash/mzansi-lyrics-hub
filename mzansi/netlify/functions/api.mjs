import { getStore } from "@netlify/blobs";

const J = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

const mkCode = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((x) => a[x % a.length]).join("");
  return `MZL-${s.slice(0, 5)}-${s.slice(5)}`;
};

export default async (req) => {
  const codes = getStore("codes");
  const content = getStore("content");
  const p = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  const load = async () => (await content.get("all", { type: "json" })) || { news: [], alerts: [], lyrics: [] };

  if (p === "content" && req.method === "GET") return J(await load());
  if (req.method !== "POST") return J({ error: "Bad request" }, 405);

  let b;
  try { b = await req.json(); } catch { return J({ error: "Bad JSON" }, 400); }

  // Public: buyer creates an order and receives a private code
  if (p === "order") {
    const code = mkCode();
    await codes.setJSON(code, {
      code,
      pkg: String(b.pkg || "").slice(0, 80),
      price: String(b.price || "").slice(0, 20),
      name: String(b.name || "").slice(0, 80),
      status: "unused",
      created: new Date().toISOString(),
    });
    return J({ code });
  }

  // Public: support / report / inquiry / join-the-team messages go to the admin inbox
  if (p === "ticket") {
    const email = String(b.email || "").trim().slice(0, 120);
    const message = String(b.message || "").trim().slice(0, 4000);
    if (!/^\S+@\S+\.\S+$/.test(email) || message.length < 3) return J({ error: "Enter a valid email and message" }, 400);
    const id = crypto.randomUUID();
    await getStore("tickets").setJSON(id, {
      id,
      type: ["support", "report", "inquiry", "join", "tip", "subscribe", "lyrics"].includes(b.type) ? b.type : "support",
      name: String(b.name || "").slice(0, 80),
      email,
      role: String(b.role || "").slice(0, 80),
      message,
      status: "new",
      created: new Date().toISOString(),
    });
    return J({ ok: true });
  }

  // Everything below is admin only (password lives on the server)
  const pass = process.env.ADMIN_PASSWORD || "Mzansi2026";
  if (b.password !== pass) return J({ error: "Wrong password" }, 401);

  if (p === "login") return J({ ok: true });

  if (p === "check") {
    const c = String(b.code || "").trim().toUpperCase();
    const rec = c ? await codes.get(c, { type: "json" }) : null;
    if (!rec) return J({ result: "invalid" });
    return J({ result: rec.status === "used" ? "used" : "valid", rec });
  }

  if (p === "use") {
    const c = String(b.code || "").trim().toUpperCase();
    const rec = await codes.get(c, { type: "json" });
    if (!rec) return J({ result: "invalid" });
    if (rec.status === "used") return J({ result: "used", rec });
    rec.status = "used";
    rec.usedAt = new Date().toISOString();
    await codes.setJSON(c, rec);
    return J({ result: "marked", rec });
  }

  if (p === "list") {
    const { blobs } = await codes.list();
    const all = await Promise.all(blobs.map((x) => codes.get(x.key, { type: "json" })));
    return J({ codes: all.filter(Boolean).sort((a, z) => z.created.localeCompare(a.created)) });
  }

  if (p === "tickets") {
    const ts = getStore("tickets");
    const { blobs } = await ts.list();
    const all = await Promise.all(blobs.map((x) => ts.get(x.key, { type: "json" })));
    return J({ tickets: all.filter(Boolean).sort((a, z) => z.created.localeCompare(a.created)) });
  }

  if (p === "ticketdone" || p === "ticketdel") {
    const ts = getStore("tickets");
    if (p === "ticketdel") { await ts.delete(String(b.id)); return J({ ok: true }); }
    const t = await ts.get(String(b.id), { type: "json" });
    if (!t) return J({ error: "Not found" }, 404);
    t.status = t.status === "answered" ? "new" : "answered";
    await ts.setJSON(t.id, t);
    return J({ ok: true });
  }

  if (p === "post" || p === "delete") {
    const t = b.type;
    if (!["news", "alerts", "lyrics"].includes(t)) return J({ error: "Bad type" }, 400);
    const c = await load();
    if (p === "post") {
      c[t].unshift({
        id: crypto.randomUUID(),
        title: String(b.title || "").slice(0, 150),
        body: String(b.body || "").slice(0, 8000),
        artist: String(b.artist || "").slice(0, 100),
        cat: String(b.cat || "").slice(0, 40),
        src: String(b.src || "").slice(0, 80),
        url: /^https?:\/\//.test(String(b.url || "")) ? String(b.url).slice(0, 300) : "",
        date: new Date().toISOString(),
      });
    } else {
      c[t] = c[t].filter((x) => x.id !== b.id);
    }
    await content.setJSON("all", c);
    return J({ ok: true });
  }

  return J({ error: "Not found" }, 404);
};

export const config = { path: "/api/*" };

// Edge Function: account — 이메일 없이 "아이디"로 가입/게스트 승격 (verify_jwt=false)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const ID = /^[a-z0-9_]{3,20}$/;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { action, username, password } = await req.json();
    const id = String(username ?? "").trim().toLowerCase();
    if (!ID.test(id)) return json({ error: "아이디는 영문 소문자·숫자·밑줄(_) 3~20자로 만들어 주세요" }, 400);
    if (String(password ?? "").length < 6) return json({ error: "비밀번호는 6자 이상이어야 해요" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const email = `${id}@studydrive.id`;
    const dup = (m: string) => (/already|registered|exists/i.test(m) ? "이미 사용 중인 아이디예요" : m);
    if (action === "signup") {
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      return error ? json({ error: dup(error.message) }, 400) : json({ ok: true });
    }
    if (action === "upgrade") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
      const { data: u, error: ue } = await admin.auth.getUser(token);
      if (ue || !u.user) return json({ error: "로그인이 필요해요" }, 401);
      const { error } = await admin.auth.admin.updateUserById(u.user.id, { email, password, email_confirm: true });
      if (error) return json({ error: dup(error.message) }, 400);
      const { error: e2 } = await admin.rpc("finish_upgrade", { uid: u.user.id });
      return e2 ? json({ error: e2.message }, 500) : json({ ok: true });
    }
    return json({ error: "bad action" }, 400);
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});

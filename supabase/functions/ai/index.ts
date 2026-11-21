// Supabase Edge Function: ai  (Dashboard > Edge Functions > Deploy a new function > Via Editor 에 붙여넣기)
// Secrets: ANTHROPIC_API_KEY (필수), AI_DAILY_LIMIT (선택, 기본 60)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const FAST = Deno.env.get("MODEL_FAST") ?? "claude-haiku-5-5";
const SMART = Deno.env.get("MODEL_SMART") ?? "claude-sonnet-5-5";
const LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "60");

async function claude(model: string, system: string, content: unknown, maxTokens: number) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`AI 호출 실패 (${r.status})`);
  const d = await r.json();
  const text = (d.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답 형식 오류");
  return JSON.parse(m[0]);
}

const imageBlock = (b64: string) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "로그인이 필요해요" }, 401);

    const { data: allowed } = await sb.rpc("hit_ai_usage", { max_n: LIMIT });
    if (allowed === false) return json({ error: `오늘 AI 사용 한도(${LIMIT}회)를 모두 썼어요. 내일 다시 이용해 주세요.` }, 429);

    const body = await req.json();
    const img = typeof body.image === "string" && body.image.length < 2_500_000 ? body.image : null;

    if (body.action === "classify") {
      const sys = `당신은 학습 자료 정리 도우미입니다. 업로드된 파일을 카테고리로 분류하세요.
기존 카테고리가 맞으면 그대로 재사용하고, 없으면 짧은 새 카테고리(예: "LC(듣기)", "RC(독해)", "어휘", "모의고사", "문법", "전공")를 만드세요.
반드시 JSON만 출력: {"category":"...","tags":["최대 4개"],"summary":"한 문장 요약(40자 이내)"}`;
      const content: unknown[] = [];
      if (img) content.push(imageBlock(img));
      content.push({ type: "text", text: `파일명: ${String(body.name ?? "").slice(0, 200)}\n기존 카테고리: ${JSON.stringify(body.categories ?? [])}\n본문 일부:\n${String(body.text ?? "").slice(0, 3000)}` });
      return json(await claude(FAST, sys, content, 400));
    }

    if (body.action === "explain") {
      const sys = `당신은 토익(TOEIC) 전문 강사입니다. 학생이 틀린 문제를 한국어로 설명하세요. 이미지가 있으면 그 문제를 읽고 설명합니다.
반드시 JSON만 출력:
{"translation":"문제/지문 핵심 해석","answer":"정답과 그 근거","reason":"학생이 틀렸을 법한 이유(학생이 고른 원인 참고)","tip":"다음에 같은 유형을 맞히는 요령 한두 문장","similar":[{"question":"유사 문제(영어)","choices":["(A)...","(B)...","(C)...","(D)..."],"answer":"(B)","explanation":"한국어 해설"},{...2개}]}
유사 문제는 같은 유형·어휘를 다루는 새 문제 2개입니다.`;
      const content: unknown[] = [];
      if (img) content.push(imageBlock(img));
      content.push({ type: "text", text: `문제 이름: ${String(body.label ?? "").slice(0, 100)}\n학생이 정한 틀린 이유: ${String(body.reason ?? "")}\n학생 메모: ${String(body.memo ?? "").slice(0, 500)}` });
      return json(await claude(SMART, sys, content, 2500));
    }

    if (body.action === "weakness") {
      const sys = `당신은 토익 학습 코치입니다. 학생의 오답 기록을 보고 약점을 분석하세요. 한국어로, 간결하게.
반드시 JSON만 출력: {"summary":"전체 진단 2문장","weaknesses":[{"topic":"약점","advice":"구체적 학습법"}],"plan":["이번 주 할 일 3개"]}`;
      const items = (Array.isArray(body.mistakes) ? body.mistakes : []).slice(0, 60);
      return json(await claude(SMART, sys, [{ type: "text", text: JSON.stringify(items) }], 1500));
    }

    return json({ error: "알 수 없는 요청" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "서버 오류" }, 500);
  }
});

// Supabase Edge Function: ai
// Secrets (둘 중 하나만 있으면 됨):
//   GEMINI_API_KEY    - 무료 (Google AI Studio에서 발급, 카드 불필요)
//   ANTHROPIC_API_KEY - 유료 (Claude)
// 선택: AI_DAILY_LIMIT(기본 60), GEMINI_MODEL, MODEL_FAST, MODEL_SMART
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "60");
type Block = { text: string } | { image: string };

function pickJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI 응답 형식 오류");
  return JSON.parse(m[0]);
}

// ── Gemini (무료 티어) ──
let geminiModel: string | null = Deno.env.get("GEMINI_MODEL") ?? null;
async function pickGeminiModel(key: string) {
  if (geminiModel) return geminiModel;
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
  const d = await r.json();
  const names: string[] = (d.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: { name: string }) => m.name.replace("models/", ""))
    .filter((n: string) => /^gemini-[\d.]+-flash$/.test(n));
  names.sort((a, b) => parseFloat(b.split("-")[1]) - parseFloat(a.split("-")[1]));
  geminiModel = names[0] ?? "gemini-2.5-flash";
  return geminiModel;
}
async function gemini(key: string, system: string, blocks: Block[], maxTokens: number) {
  const model = await pickGeminiModel(key);
  const parts = blocks.map((b) => ("text" in b ? { text: b.text } : { inline_data: { mime_type: "image/jpeg", data: b.image } }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: Math.max(maxTokens, 2048) },
    }),
  });
  if (r.status === 429) throw new Error("AI 무료 사용량이 잠시 가득 찼어요. 1분 뒤 다시 시도해 주세요.");
  if (!r.ok) throw new Error(`AI 호출 실패 (${r.status})`);
  const d = await r.json();
  const text = (d.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  return pickJson(text);
}

// ── Claude ──
async function claude(key: string, smart: boolean, system: string, blocks: Block[], maxTokens: number) {
  const model = smart ? (Deno.env.get("MODEL_SMART") ?? "claude-sonnet-5-5") : (Deno.env.get("MODEL_FAST") ?? "claude-haiku-5-5");
  const content = blocks.map((b) => ("text" in b ? { type: "text", text: b.text } : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.image } }));
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`AI 호출 실패 (${r.status})`);
  const d = await r.json();
  return pickJson((d.content ?? []).map((c: { text?: string }) => c.text ?? "").join(""));
}

function llm(smart: boolean, system: string, blocks: Block[], maxTokens: number) {
  const g = Deno.env.get("GEMINI_API_KEY");
  if (g) return gemini(g, system, blocks, maxTokens);
  const a = Deno.env.get("ANTHROPIC_API_KEY");
  if (a) return claude(a, smart, system, blocks, maxTokens);
  throw new Error("AI 키가 설정되지 않았어요 (GEMINI_API_KEY 또는 ANTHROPIC_API_KEY)");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "로그인이 필요해요" }, 401);

    const { data: allowed } = await sb.rpc("hit_ai_usage", { max_n: LIMIT });
    if (allowed === false) return json({ error: `오늘 AI 사용 한도(${LIMIT}회)를 모두 썼어요. 내일 다시 이용해 주세요.` }, 429);

    const body = await req.json();
    const img = typeof body.image === "string" && body.image.length < 2_500_000 ? body.image : null;
    const withImg = (text: string): Block[] => (img ? [{ image: img }, { text }] : [{ text }]);

    if (body.action === "classify") {
      const sys = `당신은 학습 자료 정리 도우미입니다. 업로드된 파일을 카테고리로 분류하세요.
기존 카테고리가 맞으면 그대로 재사용하고, 없으면 짧은 새 카테고리(예: "LC(듣기)", "RC(독해)", "어휘", "모의고사", "문법", "전공")를 만드세요.
반드시 JSON만 출력: {"category":"...","tags":["최대 4개"],"summary":"한 문장 요약(40자 이내)"}`;
      return json(await llm(false, sys, withImg(`파일명: ${String(body.name ?? "").slice(0, 200)}\n기존 카테고리: ${JSON.stringify(body.categories ?? [])}\n본문 일부:\n${String(body.text ?? "").slice(0, 3000)}`), 400));
    }

    if (body.action === "explain") {
      const sys = `당신은 시험 전문 강사입니다(토익이면 토익 강사). 학생이 틀린 문제를 한국어로 설명하세요. 이미지가 있으면 그 문제를 읽고 설명합니다.
반드시 JSON만 출력:
{"translation":"문제/지문 핵심 해석","answer":"정답과 그 근거","reason":"학생이 틀렸을 법한 이유(학생이 고른 원인 참고)","tip":"다음에 같은 유형을 맞히는 요령 한두 문장","similar":[{"question":"유사 문제","choices":["(A)...","(B)...","(C)...","(D)..."],"answer":"(B)","explanation":"한국어 해설"}]}
유사 문제는 같은 유형을 다루는 새 문제 2개입니다.`;
      return json(await llm(true, sys, withImg(`문제 이름: ${String(body.label ?? "").slice(0, 100)}\n학생이 정한 틀린 이유: ${String(body.reason ?? "")}\n학생 메모: ${String(body.memo ?? "").slice(0, 500)}`), 2500));
    }

    if (body.action === "ask") {
      const sys = `당신은 학습 도우미입니다. 첨부된 쪽(이미지)의 내용을 근거로 한국어로 간결하게 답하세요.
쪽에 없는 내용은 "이 쪽에는 없어요"라고 말하고, 일반 지식으로 보충할 땐 "일반 지식:"이라고 구분하세요.
반드시 JSON만 출력: {"answer":"답변 (마크다운 기호 없이 줄바꿈으로 구분)"}`;
      const hist = (Array.isArray(body.history) ? body.history : []).slice(-6).map((h: { role: string; content: string }) => `${h.role === "user" ? "학생" : "도우미"}: ${String(h.content).slice(0, 600)}`).join("\n");
      return json(await llm(true, sys, withImg(`${hist ? `이전 대화:\n${hist}\n\n` : ""}학생 질문: ${String(body.question ?? "").slice(0, 800)}`), 1500));
    }

    if (body.action === "quiz") {
      const sys = `당신은 학습 코치입니다. 학생의 오답 기록을 바탕으로 같은 유형을 연습할 4지선다 문제 5개를 만드세요.
토익/영어 시험이면 영어 문제, 그 외는 해당 과목의 언어로 냅니다. 각 문제는 서로 다른 오답 항목을 겨냥하세요. 해설은 한국어.
반드시 JSON만 출력: {"questions":[{"question":"...","choices":["보기1","보기2","보기3","보기4"],"answer":"B","explanation":"...","target":"겨냥한 오답 항목"}]}
choices에는 (A) 같은 기호를 붙이지 마세요. answer는 A~D 중 하나.`;
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 12);
      return json(await llm(true, sys, [{ text: JSON.stringify(items) }], 3000));
    }

    if (body.action === "weakness") {
      const sys = `당신은 학습 코치입니다. 학생의 오답 기록을 보고 약점을 분석하세요. 한국어로, 간결하게.
반드시 JSON만 출력: {"summary":"전체 진단 2문장","weaknesses":[{"topic":"약점","advice":"구체적 학습법"}],"plan":["이번 주 할 일 3개"]}`;
      const items = (Array.isArray(body.mistakes) ? body.mistakes : []).slice(0, 60);
      return json(await llm(true, sys, [{ text: JSON.stringify(items) }], 1500));
    }

    return json({ error: "알 수 없는 요청" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "서버 오류" }, 500);
  }
});

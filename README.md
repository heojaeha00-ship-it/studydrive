# 스터디드라이브

## ⭐ 핵심: 기기 간 실시간 동기화
PC·태블릿·폰에서 **같은 계정**으로 열면 필기·오답·파일이 **새로고침 없이** 서로 나타납니다.
- 화면 위 칩에 **연결된 기기(💻 📟 📱)** 가 실시간으로 표시됩니다.
- **QR로 폰 연결**: 로그인 후 `다른 기기로 열기` → 폰 카메라로 QR (시연용, 약 1시간 유지).
- 직접 확인: PC에서 PDF를 열고 폰에서도 같은 파일을 연 뒤, 한쪽에서 필기해 보세요.
- 자동 측정(`node tests/sync.js`, 실제 배포 사이트·PC/폰 화면 2개 동시 접속): 필기 → 다른 기기 **약 2.3초**, 오답 등록 → **약 0.6초**, 노트 생성 → 목록 **약 6.3초**(PDF 제작·업로드 포함).

> **60초 체험** — https://heojaeha00-ship-it.github.io/studydrive/
> 1. (0~10초) **가입 없이 체험하기**를 누릅니다.
> 2. (10~20초) **토익 900 정복 → 이 템플릿으로 시작**. 폴더·예시 PDF·복습 일정이 한 번에 만들어집니다.
> 3. (20~35초) **오늘 복습**: 확신도를 고르고 답을 적은 뒤 **정답 확인** → AI 채점 → 4단계 평가.
> 4. (35~50초) **내 파일**에서 PDF를 열어 형광펜 필기 → **AI 질문**·**🃏 카드**·**오답 등록**(AI 해설).
> 5. (50~60초) **오답노트**에서 **AI 약점 분석**·**AI 맞춤 퀴즈**(틀린 문제는 자동 오답 등록).
>
> 같은 계정으로 폰·태블릿·PC에 로그인하면 필기와 오답이 이어집니다. 자동 점검: `node tests/e2e.js`

태블릿·폰·PC 어디서든 같은 계정으로 이어서 공부하는 AI 학습 드라이브 (PWA).

- 파일 업로드 → AI 자동 분류(카테고리·태그·요약), 어느 기기에서든 다운로드 없이 열람
- PDF·이미지 위에 펜/형광펜 필기, 자동 저장 · 기기 간 동기화
- 틀린 문제 등록 → AI 해설·유사 문제 → 1·3·7·14일 간격 복습 스케줄
- AI 약점 분석 · AI 질문(보고 있는 쪽 기준) · 내 오답 기반 AI 맞춤 퀴즈
- 둘러보기 탭: 원클릭 시작 세팅(토익/대학/자격증), 4단계 복습(다시·어려움·좋음·쉬움)

## 구조
`index.html` + `dist/app.js`(빌드 결과, 커밋됨) · 백엔드는 Supabase(Auth·DB·Storage) + Edge Function(`ai`)

## 배포 (한 번만)
1. Supabase 프로젝트 생성 → SQL Editor에 `supabase/schema.sql` 전체 실행
2. Authentication → Sign In / Providers: **Allow anonymous sign-ins 켜기**(가입 없이 체험), Email의 **Confirm email 끄기**(선택)
3. Edge Functions → Deploy a new function → 이름 `ai` → `supabase/functions/ai/index.ts` 붙여넣기 → Deploy
4. Edge Functions → Secrets → AI 키 추가 (둘 중 하나)
   - **무료**: `GEMINI_API_KEY` — https://aistudio.google.com/apikey 에서 발급 (카드 불필요)
   - 유료: `ANTHROPIC_API_KEY`
   - 선택: `AI_DAILY_LIMIT` (기본 사용자당 하루 60회)
5. `config.js`에 Project URL / anon key (+ 데모 계정) 입력
6. GitHub Pages 켜기 (Settings → Pages → main / root)

## 개발
```
npm install
npm run build     # dist/app.js 생성
python3 -m http.server 8765
```
`config.js`가 비어 있으면 로컬 모드(이 기기 IndexedDB)로 동작합니다.

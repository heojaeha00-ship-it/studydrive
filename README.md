# 스터디드라이브

태블릿·폰·PC 어디서든 같은 계정으로 이어서 공부하는 AI 학습 드라이브 (PWA).

- 파일 업로드 → AI 자동 분류(카테고리·태그·요약), 어느 기기에서든 다운로드 없이 열람
- PDF·이미지 위에 펜/형광펜 필기, 자동 저장 · 기기 간 동기화
- 틀린 문제 등록 → AI 해설·유사 문제 → 1·3·7·14일 간격 복습 스케줄
- AI 약점 분석

## 구조
`index.html` + `dist/app.js`(빌드 결과, 커밋됨) · 백엔드는 Supabase(Auth·DB·Storage) + Edge Function(`ai`)

## 배포 (한 번만)
1. Supabase 프로젝트 생성 → SQL Editor에 `supabase/schema.sql` 전체 실행
2. Authentication → Providers → Email → **Confirm email 끄기** (심사위원 가입이 쉬워짐)
3. Edge Functions → Deploy a new function → 이름 `ai` → `supabase/functions/ai/index.ts` 붙여넣기 → Deploy
4. Edge Functions → Secrets → `ANTHROPIC_API_KEY` 추가 (선택: `AI_DAILY_LIMIT`, 기본 사용자당 하루 60회)
5. `config.js`에 Project URL / anon key (+ 데모 계정) 입력
6. GitHub Pages 켜기 (Settings → Pages → main / root)

## 개발
```
npm install
npm run build     # dist/app.js 생성
python3 -m http.server 8765
```
`config.js`가 비어 있으면 로컬 모드(이 기기 IndexedDB)로 동작합니다.

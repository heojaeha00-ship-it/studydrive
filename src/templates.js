// 원클릭 시작 세팅. 모든 예시 문제·해설은 직접 작성한 것이며 상용 교재 내용이 아님.
const EX = '예시';

export const PRESETS = {
  basic: { name: '기본 (1·3·7·14일)', intervals: [1, 3, 7, 14] },
  exam: { name: '시험 임박 (1·2·4·7일)', intervals: [1, 2, 4, 7] },
  long: { name: '장기 기억 (1·3·7·14·30일)', intervals: [1, 3, 7, 14, 30] },
};

export const TEMPLATES = [
  {
    id: 'sea',
    short: '해상교통법(COLREG)·항해학 · 해기사 시험 · 동그라미 오답',
    emoji: '⚓',
    title: '해기사·항해 시험',
    who: '해기사 면허·항해학·해상교통법 학습 (해양대생)',
    desc: '항해학·법규·영어·기관 폴더, 해기사용 오답 원인, 해상충돌예방규칙(COLREG) 샘플 문제와 오답 3개가 한 번에 만들어져요.',
    preset: 'exam',
    reasons: ['규칙 번호 혼동', '용어·영문 해석', '등화·형상물 암기', '피항 판단 실수', '계산 실수', '시간 부족', '기타'],
    cats: ['항해', '법규', '운용·기관', '영어', '기출'],
    steps: ['기출·교재 PDF를 올리면 AI가 과목별로 자동 분류', '틀린 문제를 펜으로 동그라미 치면 오답이 바로 등록돼요', '규칙 번호·등화 같은 암기는 간격 반복으로 복습'],
    notes: [
      {
        name: 'COLREG 샘플 문제 (직접 제작).pdf', category: '법규', tags: [EX, 'COLREG'], summary: '충돌예방규칙 5문제 연습용 샘플', sample: 'colreg',
      },
      {
        name: '항해등 암기표 (예시).md', category: '법규', tags: [EX, '등화'], summary: '항해등 각도와 색 정리',
        content: `# 항해등 암기표 (예시)

- 마스트등(흰색): 정선수 방향 기준 좌우 112.5°씩, 합계 225°
- 현등(우현 녹색 / 좌현 홍색): 각각 112.5°
- 선미등(흰색): 135°
- 길이 50m 이상 동력선: 마스트등 2개(앞 낮게·뒤 높게)

기억법: 112.5 + 112.5 = 225, 225 + 135 = 360
`,
      },
      { name: '필기 연습 노트 (예시).pdf', category: '노트', tags: [EX, '노트', '모눈'], summary: '해도·침로 작도 연습용 모눈 노트', blank: 'grid' },
    ],
    mistakes: [
      {
        note: 0, label: '[예시] COLREG 제14조 · 마주치는 상태', reason: '규칙 번호 혼동', memo: '정면 마주침에서 어느 쪽으로 변침하는지 헷갈림',
        ai: {
          translation: '두 동력선이 정면 또는 거의 정면으로 마주쳐 충돌 위험이 있을 때의 행동을 묻는 문제',
          answer: '각 선박은 서로 다른 선박의 좌현 쪽으로 지나가도록 모두 우현(오른쪽)으로 변침합니다. (제14조)',
          reason: '제15조(횡단)의 “피항선·유지선” 개념과 섞어 기억하면 혼동하기 쉬워요. 마주치는 상태에는 유지선이 없고 둘 다 피합니다.',
          tip: '“마주치면 둘 다 우현으로” — 자동차 우측통행과 연결해 기억하기',
          similar: [{ question: '두 동력선이 정면으로 마주치는 상태에서 올바른 조치는?', choices: ['(A) 한 척만 우현으로 변침', '(B) 두 척 모두 우현으로 변침', '(C) 두 척 모두 좌현으로 변침', '(D) 속력이 빠른 선박이 유지'], answer: '(B)', explanation: '제14조에 따라 두 선박 모두 우현으로 변침해 서로 좌현 대 좌현으로 지나갑니다.' }],
        },
      },
      {
        note: 1, label: '[예시] 항해등 · 선미등 각도', reason: '등화·형상물 암기', memo: '135°인지 112.5°인지 헷갈림',
        ai: {
          translation: '항해 중인 동력선의 선미등이 비추는 범위를 묻는 문제',
          answer: '선미등은 흰색이고 정선미 방향 기준 135° 범위를 비춥니다.',
          reason: '마스트등 225°, 현등 112.5°와 숫자를 섞어 외우면 틀리기 쉬워요.',
          tip: '112.5 + 112.5 + 135 = 360 으로 한 번에 점검하기',
          similar: [{ question: '마스트등의 수평 비추는 범위는?', choices: ['(A) 112.5°', '(B) 135°', '(C) 225°', '(D) 360°'], answer: '(C)', explanation: '정선수 방향 기준 좌우 각각 112.5°, 합계 225°입니다.' }],
        },
      },
      {
        note: 0, label: '[예시] COLREG 제15조 · 횡단 상태', reason: '피항 판단 실수', memo: '누가 피항선인지 헷갈림',
        ai: {
          translation: '두 동력선이 횡단하며 충돌 위험이 있을 때 피항선을 고르는 문제',
          answer: '상대 선박을 자기 선박의 우현 쪽에서 보는 선박이 피항선이며, 되도록 상대 선박의 선수 쪽을 가로지르지 않고 피해야 합니다. (제15조)',
          reason: '“내 오른쪽에 상대가 있으면 내가 피한다”를 거꾸로 기억하면 판단이 뒤집혀요.',
          tip: '“오른쪽에서 오면 내가 비킨다”로 외우고 그림으로 확인하기',
          similar: [{ question: 'A선의 우현 쪽에서 B선이 횡단해 접근한다. 피항선은?', choices: ['(A) A선', '(B) B선', '(C) 둘 다', '(D) 큰 선박'], answer: '(A)', explanation: 'A선은 B선을 자기의 우현 쪽에서 보므로 A선이 피항선입니다.' }],
        },
      },
    ],
  },
  {
    id: 'toeic',
    short: '파트별 폴더 · 예시 문제 · 복습 일정 자동 세팅',
    emoji: '🎯',
    title: '토익 900 정복',
    who: '토익 800점대 → 900점 목표',
    desc: '파트별 폴더, 토익 맞춤 오답 원인, 1·3·7·14일 복습, 샘플 문제와 오답 3개가 한 번에 만들어져요.',
    preset: 'basic',
    reasons: ['어휘', '문법', '듣기 놓침', '시간 부족', '함정 선택지', '찍어서 맞음', '기타'],
    cats: ['LC(듣기)', 'RC(독해)', '어휘', '모의고사', '계획'],
    steps: ['PDF 문제집을 올리면 AI가 LC/RC로 자동 분류', '풀다가 틀린 문제에서 [오답 등록]', '내일부터 [오늘 복습]에 자동으로 떠요'],
    notes: [
      {
        name: 'TOEIC Part5 샘플 문제 (직접 제작).pdf', category: 'RC(독해)', tags: [EX, 'Part5'], summary: '문법·어휘 5문제 연습용 샘플', sample: 'toeic5',
      },
      {
        name: '토익 필수 어휘 체크리스트 (예시).md', category: '어휘', tags: [EX, '어휘'], summary: '자주 나오는 비즈니스 어휘 10개',
        content: `# 필수 어휘 체크 (예시)

- implement — 시행하다 (implement a policy)
- submit — 제출하다
- appoint — 임명하다
- reserve — 예약하다
- recognize — 인정하다, 알아보다
- reimburse — 상환하다, 환급하다
- postpone — 연기하다
- invoice — 청구서
- warranty — 품질 보증
- renew — 갱신하다
`,
      },
      {
        name: '900점 주간 학습 계획 (예시).md', category: '계획', tags: [EX, '계획'], summary: '신규 풀이 3 : 분석 4 : 복습 3',
        content: `# 900점 주간 계획 (예시)

시간 배분 = 신규 풀이 3 : 오답 분석 4 : 복습 3

- 월~금: 파트별 풀이 → 틀린 문제 바로 [오답 등록]
- 매일: [오늘 복습] 먼저 끝내기 (1·3·7·14일 주기)
- 토요일: 실전 모의고사 1세트 (시간 엄수)
- 일요일: 이번 주 오답 총복습 + AI 약점 분석 확인
`,
      },
    ],
    mistakes: [
      {
        note: 0, label: '[예시] Part5 #1 · to부정사', reason: '문법', memo: 'ask + 목적어 + to V',
        ai: {
          translation: '관리자는 모든 직원에게 금요일 전에 보고서를 제출하라고 요청했다.',
          answer: '(A) submit. ask + 목적어 + to + 동사원형 구조라서 to 뒤에는 동사원형이 옵니다.',
          reason: "to 뒤에 -ing나 명사를 고르기 쉬워요. 'to'가 to부정사인지 전치사인지 먼저 구분하세요.",
          tip: 'ask / want / allow / enable + 목적어 + to V 패턴을 한 덩어리로 외우기',
          similar: [{ question: 'The supervisor advised the interns to ______ the safety guide carefully.', choices: ['(A) read', '(B) reading', '(C) reader', '(D) reads'], answer: '(A)', explanation: 'advise + 목적어 + to V 이므로 to 뒤에는 동사원형 read가 알맞습니다.' }],
        },
      },
      {
        note: 0, label: '[예시] Part5 #2 · 어휘 짝(collocation)', reason: '어휘', memo: '정책 → implement',
        ai: {
          translation: '회사는 다음 달에 새로운 에너지 절약 정책을 시행할 것이다.',
          answer: '(A) implement. implement a policy(정책을 시행하다)가 자주 쓰이는 짝입니다. appoint는 사람 임명, attend는 행사 참석, reserve는 예약.',
          reason: '단어 뜻은 알아도 “정책”과 어울리는 동사를 몰라 헷갈리는 유형이에요.',
          tip: '명사와 짝으로 외우기: implement a policy / plan / system',
          similar: [{ question: 'The board decided to ______ a new training program for sales staff.', choices: ['(A) implement', '(B) occupy', '(C) retire', '(D) borrow'], answer: '(A)', explanation: '“프로그램을 시행하다”는 implement가 자연스럽습니다.' }],
        },
      },
      {
        note: null, label: '[예시] Part2 · Where 의문문', reason: '듣기 놓침', memo: '첫 단어를 못 들음',
        ai: {
          translation: 'Q: Where can I find the printer toner? → (A) In the supply room. (B) Yes, it’s on sale. (C) At 3 o’clock. / “프린터 토너는 어디서 찾을 수 있나요?”',
          answer: '(A). Where 질문에는 장소로 답해야 합니다. (B)는 Yes/No 답변, (C)는 시간(When)에 대한 답이에요.',
          reason: '문장 첫 단어 Where를 놓치면 When/What으로 착각해 오답을 고르게 돼요.',
          tip: '의문사를 가장 먼저 받아 적기. 첫 단어에 집중하는 연습을 하세요.',
          similar: [{ question: 'Q: Where should I leave the signed contract?', choices: ['(A) With the receptionist.', '(B) By the end of the month.', '(C) Yes, I signed it.'], answer: '(A)', explanation: '장소를 묻는 질문이므로 접수 담당자에게 두라는 (A)가 맞습니다.' }],
        },
      },
    ],
  },
  {
    id: 'college',
    short: '과목 폴더 · 개념 오답 분류 · 시험 대비',
    emoji: '🎓',
    title: '대학 수업·시험 대비',
    who: '강의자료·필기·중간/기말 준비',
    desc: '전공·교양·과제·시험 폴더와 개념 중심 오답 원인, 샘플 노트와 오답 2개를 만들어요.',
    preset: 'basic',
    reasons: ['개념 이해 부족', '암기 부족', '계산·적용 실수', '문제 해석', '시간 부족', '기타'],
    cats: ['전공', '교양', '과제', '시험'],
    steps: ['강의 PDF를 올리면 과목별로 자동 분류', '태블릿에서 필기하고 폰으로 이동 중 복습', '시험 직전엔 오답노트와 AI 퀴즈로 총정리'],
    notes: [
      {
        name: '알고리즘 1주차 수업 노트 (예시).md', category: '전공', tags: [EX, '알고리즘'], summary: '시간 복잡도와 이진 탐색 정리',
        content: `# 알고리즘 1주차 (예시 노트)

## 핵심 키워드
시간 복잡도, Big-O, 선형 탐색, 이진 탐색

## 노트
- 선형 탐색: 처음부터 끝까지 확인 → O(n)
- 이진 탐색: 정렬된 배열에서 범위를 매번 절반으로 줄임 → O(log n)

## 요약
"절반으로 줄인다 = log" 로 연결해서 기억하기.
`,
      },
      { name: '필기 연습 노트 (예시).pdf', category: '노트', tags: [EX, '노트', '줄노트'], summary: '펜으로 필기해 보는 빈 노트', blank: 'lined' },
      {
        name: '중간고사 체크리스트 (예시).md', category: '시험', tags: [EX, '시험'], summary: '범위 확인·오답 복습·AI 퀴즈 순서',
        content: `# 중간고사 체크리스트 (예시)

1. 시험 범위 슬라이드 모두 업로드
2. 연습문제 풀고 틀린 것 [오답 등록]
3. D-3부터 [오늘 복습] 매일 완료
4. D-1 [AI 맞춤 퀴즈]로 마무리
`,
      },
    ],
    mistakes: [
      {
        note: 0, label: '[예시] 중간고사 2번 · 이진 탐색 복잡도', reason: '개념 이해 부족', memo: '선형 탐색과 혼동',
        ai: {
          translation: '정렬된 배열에서 이진 탐색의 시간 복잡도는?',
          answer: 'O(log n). 한 번 비교할 때마다 탐색 범위가 절반으로 줄기 때문입니다.',
          reason: '선형 탐색 O(n)과 혼동했을 가능성이 커요. “정렬되어 있어야 한다”는 조건을 놓치기도 합니다.',
          tip: '“절반으로 줄인다 → log”를 한 문장으로 연결해 외우기',
          similar: [{ question: '10억 개의 정렬된 원소에서 이진 탐색의 최대 비교 횟수는 대략 얼마인가?', choices: ['(A) 10회', '(B) 30회', '(C) 1,000회', '(D) 1,000,000회'], answer: '(B)', explanation: '2^30 ≈ 10.7억 이므로 약 30번 비교하면 찾을 수 있습니다.' }],
        },
      },
      {
        note: 0, label: '[예시] 암기 · TCP와 UDP 차이', reason: '암기 부족', memo: '신뢰성 vs 속도',
        ai: {
          translation: 'TCP와 UDP의 대표적인 차이를 묻는 문제',
          answer: 'TCP는 연결 지향·신뢰성(재전송), UDP는 비연결·빠름(스트리밍, DNS 등).',
          reason: '두 개념의 “장단점 짝”을 함께 외우지 않으면 서로 바꿔 기억하기 쉬워요.',
          tip: '표로 정리: 연결 여부 / 신뢰성 / 속도 / 대표 용도',
          similar: [{ question: '실시간 화상 통화에서 일부 패킷 손실을 감수하고 지연을 줄이려 할 때 더 적합한 프로토콜은?', choices: ['(A) TCP', '(B) UDP'], answer: '(B)', explanation: 'UDP는 재전송 없이 빠르게 전송하므로 실시간 전송에 적합합니다.' }],
        },
      },
    ],
  },
  {
    id: 'cert',
    short: '기출 폴더 · 촘촘한 복습(1·2·4·7일)',
    emoji: '📜',
    title: '자격증·공무원 기출',
    who: '시험일이 정해진 기출 반복형',
    desc: '시험이 가까운 사람용으로 복습 주기를 1·2·4·7일로 촘촘하게 세팅하고, 기출·요약·암기 폴더를 만들어요.',
    preset: 'exam',
    reasons: ['개념 부족', '암기 안 됨', '함정 문제', '계산 실수', '시간 부족', '기타'],
    cats: ['기출', '오답', '요약', '암기'],
    steps: ['기출 PDF를 올리고 풀면서 바로 필기', '틀린 이유를 “함정/암기/개념”으로 분류', '하루 한 번 [오늘 복습]으로 2~4일 간격 반복'],
    notes: [
      {
        name: '한국사 연표 요약 (예시).md', category: '요약', tags: [EX, '한국사'], summary: '임진왜란·훈민정음 핵심 연도',
        content: `# 한국사 연표 요약 (예시)

- 1443: 훈민정음 창제
- 1446: 훈민정음 반포
- 1592: 임진왜란 발발, 한산도 대첩
- 임진왜란 3대 대첩: 한산도·진주·행주
`,
      },
      { name: '필기 연습 노트 (예시).pdf', category: '노트', tags: [EX, '노트', '줄노트'], summary: '펜으로 필기해 보는 빈 노트', blank: 'lined' },
      {
        name: '기출 풀이 루틴 (예시).md', category: '기출', tags: [EX, '루틴'], summary: '풀이 → 오답 등록 → 복습',
        content: `# 기출 풀이 루틴 (예시)

1. 시간을 재고 한 회차 풀기
2. 틀린 문제는 이유를 골라 [오답 등록]
3. 같은 날 AI 해설 확인, 다음 날부터 자동 복습
`,
      },
    ],
    mistakes: [
      {
        note: 0, label: '[예시] 한산도 대첩 연도', reason: '암기 안 됨', memo: '1592년',
        ai: {
          translation: '이순신이 학익진으로 일본 수군을 크게 물리친 한산도 대첩의 시기를 묻는 문제',
          answer: '1592년(임진왜란 발발 해). 임진왜란 3대 대첩은 한산도·진주·행주 대첩입니다.',
          reason: '명량 대첩(1597, 정유재란)과 시기를 섞어 기억하기 쉬워요.',
          tip: '“임진년(1592)에 한산도, 정유년(1597)에 명량”으로 짝 지어 외우기',
          similar: [{ question: '다음 중 임진왜란 3대 대첩이 아닌 것은?', choices: ['(A) 한산도 대첩', '(B) 진주 대첩', '(C) 행주 대첩', '(D) 명량 대첩'], answer: '(D)', explanation: '명량 대첩은 정유재란(1597) 때의 승리입니다.' }],
        },
      },
      {
        note: 0, label: '[예시] 훈민정음 창제와 반포', reason: '함정 문제', memo: '창제 ≠ 반포',
        ai: {
          translation: '훈민정음의 창제 연도와 반포 연도를 구분하는 문제',
          answer: '창제 1443년, 반포 1446년입니다.',
          reason: '출제자가 “창제”와 “반포”를 바꿔 내는 전형적인 함정이에요.',
          tip: '“43 만들고 46 알렸다” — 두 숫자를 짝으로 외우기',
          similar: [{ question: '훈민정음이 일반에 널리 알려진 해로 알맞은 것은?', choices: ['(A) 1443년', '(B) 1446년', '(C) 1392년', '(D) 1592년'], answer: '(B)', explanation: '1446년에 훈민정음을 반포했습니다.' }],
        },
      },
    ],
  },
];

export const SCENARIOS = [
  { emoji: '📱', title: '태블릿에서 풀고, 폰으로 복습', body: '같은 계정이면 필기·오답이 이어져요', href: '#/files' },
  { emoji: '📝', title: '빈 노트에 바로 필기', body: '백지·줄·모눈·점·코넬 노트 생성', href: '#/files' },
  { emoji: '💬', title: '모르는 쪽을 AI에게 질문', body: '보고 있는 쪽을 읽고 설명해 줘요', href: '#/files' },
  { emoji: '📒', title: '틀린 이유로 약점 찾기', body: '원인별 통계와 AI 진단', href: '#/mistakes' },
  { emoji: '🎯', title: '내 오답으로 AI 퀴즈', body: '같은 유형의 새 문제 5개', href: '#/quiz' },
  { emoji: '🔁', title: '잊을 때쯤 자동 복습', body: '다시·어려움·좋음·쉬움만 고르면 끝', href: '#/review' },
];

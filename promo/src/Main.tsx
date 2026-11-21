import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

// ── 앱 정보 ───────────────────────────────────────────────
const APP = '스터디드라이브';
const SLOGAN = '공부는 한 곳에, 어느 기기에서나';
const BG = '#0F172A', ACC = '#10B981', ACC2 = '#6366F1', TXT = '#F8FAFC', MUTE = '#94A3B8';
const FONT = '"Pretendard","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif';
const BEAT = 30; // 프레임 (120BPM @60fps)

// 박자 반응: 가장 최근 킥 이후 경과 프레임으로 스프링을 돌려 0→1→0 펄스를 만든다.
const usePulse = (strength = 1) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const since = f % BEAT;
  const s = spring({ frame: since, fps, config: { damping: 9, stiffness: 220, mass: 0.6 }, from: 1, to: 0 });
  return s * strength;
};
const useIn = (start: number, cfg = { damping: 13, stiffness: 120, mass: 0.8 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  return spring({ frame: f - start, fps, config: cfg });
};
const fade = (f: number, a: number, b: number, c: number, d: number) => interpolate(f, [a, b, c, d], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

// ── 공용 조각 ─────────────────────────────────────────────
const Glow = () => {
  const f = useCurrentFrame(); const p = usePulse();
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div style={{ position: 'absolute', width: 1300, height: 1300, left: -110 + Math.sin(f / 90) * 90, top: 120 + Math.cos(f / 110) * 120, borderRadius: '50%', background: `radial-gradient(circle, ${ACC}${Math.round(55 + p * 70).toString(16).padStart(2, '0')} 0%, transparent 62%)`, transform: `scale(${1 + p * 0.1})`, filter: 'blur(30px)' }} />
      <div style={{ position: 'absolute', width: 1100, height: 1100, right: -420 + Math.cos(f / 100) * 90, bottom: -80, borderRadius: '50%', background: `radial-gradient(circle, ${ACC2}60 0%, transparent 62%)`, transform: `scale(${1 + p * 0.07})`, filter: 'blur(30px)' }} />
      <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px)', backgroundSize: '90px 90px' }} />
    </AbsoluteFill>
  );
};
const Logo = ({ size = 160 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={ACC2} /><stop offset="1" stopColor={ACC} /></linearGradient></defs>
    <rect width="64" height="64" rx="16" fill="url(#lg)" /><path d="M18 20h28v22H30l-8 7v-7h-4z" fill="#fff" opacity=".95" /><path d="M24 29h16M24 35h10" stroke={ACC2} strokeWidth="3" strokeLinecap="round" /></svg>
);
const Card = ({ children, style, tilt = 0 }: { children: React.ReactNode; style?: React.CSSProperties; tilt?: number }) => {
  const p = usePulse();
  return <div style={{ background: 'rgba(30,41,59,.82)', border: '1.5px solid rgba(255,255,255,.12)', borderRadius: 44, padding: 44, boxShadow: '0 40px 100px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.12)', backdropFilter: 'blur(20px)', transform: `perspective(1600px) rotateY(${tilt}deg) rotateX(${tilt * -0.3}deg) scale(${1 + p * 0.025})`, ...style }}>{children}</div>;
};
const Word = ({ text, start, size = 118, color = TXT }: { text: string; start: number; size?: number; color?: string }) => {
  const s = useIn(start, { damping: 11, stiffness: 160, mass: 0.7 });
  return <div style={{ overflow: 'hidden', height: size * 1.2 }}><div style={{ fontSize: size, fontWeight: 900, lineHeight: 1.2, letterSpacing: -4, color, transform: `translateY(${(1 - s) * 130}%)`, opacity: Math.min(1, s * 2) }}>{text}</div></div>;
};

// ── 씬 1 (0~180f): 키네틱 타이포 + 로고 ───────────────────
const Intro = () => {
  const f = useCurrentFrame(); const s = useIn(100, { damping: 10, stiffness: 140, mass: 0.7 }); const p = usePulse();
  return (
    <AbsoluteFill style={{ fontFamily: FONT, padding: 90, justifyContent: 'center' }}>
      <div style={{ opacity: 1 - interpolate(f, [100, 120], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * 1, position: 'absolute', left: 90, right: 90, top: 560 }}>
        <Word text="필기는 태블릿" start={0} /><Word text="자료는 PC" start={BEAT / 1} color={ACC} /><Word text="복습은 폰" start={BEAT * 2} />
      </div>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: s }}>
        <div style={{ transform: `scale(${(0.4 + s * 0.6) * (1 + p * 0.06)}) rotate(${(1 - s) * -25}deg)` }}><Logo size={300} /></div>
        <div style={{ fontSize: 112, fontWeight: 900, color: TXT, marginTop: 50, letterSpacing: -3 }}>{APP}</div>
        <div style={{ fontSize: 46, color: MUTE, marginTop: 18, opacity: interpolate(f, [130, 160], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }) }}>{SLOGAN}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── 씬 2 (180~420f): 기능 1 — 기기 간 실시간 동기화 ────────
const Device = ({ w, h, r, children, style }: any) => <div style={{ width: w, height: h, borderRadius: r, background: '#0B1222', border: '8px solid #334155', boxShadow: '0 30px 80px rgba(0,0,0,.55)', overflow: 'hidden', position: 'relative', ...style }}>{children}</div>;
const Feature1 = () => {
  const f = useCurrentFrame(); const a = useIn(0); const stroke = interpolate(f, [60, 150], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const t2 = interpolate(f, [100, 170], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tilt = interpolate(f, [0, 240], [-16, 8]);
  const path = 'M60 220 C 140 80, 220 340, 300 200 S 440 120, 500 260';
  return (
    <AbsoluteFill style={{ fontFamily: FONT, alignItems: 'center' }}>
      <div style={{ marginTop: 150, textAlign: 'center', opacity: a, transform: `translateY(${(1 - a) * 50}px)` }}>
        <div style={{ fontSize: 40, color: ACC, fontWeight: 800, letterSpacing: 6 }}>FEATURE 01</div>
        <div style={{ fontSize: 96, fontWeight: 900, color: TXT, marginTop: 14, letterSpacing: -3 }}>적는 즉시,<br />모든 기기에</div>
      </div>
      <div style={{ position: 'absolute', top: 640, width: '100%', display: 'flex', justifyContent: 'center', gap: 50, alignItems: 'flex-end' }}>
        <Card tilt={tilt} style={{ padding: 28 }}>
          <Device w={620} h={460} r={30}>
            <div style={{ color: MUTE, fontSize: 26, padding: '18px 26px' }}>✍️ 토익 Part 5 · 필기</div>
            <svg width="620" height="400" viewBox="0 0 560 400" style={{ position: 'absolute', top: 60, left: 0 }}><path d={path} stroke={ACC} strokeWidth="9" fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - stroke} /></svg>
          </Device>
          <div style={{ color: MUTE, fontSize: 30, textAlign: 'center', marginTop: 20 }}>태블릿</div>
        </Card>
        <Card tilt={-tilt * 0.6} style={{ padding: 22, opacity: interpolate(f, [90, 110], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <Device w={250} h={440} r={40}>
            <div style={{ color: MUTE, fontSize: 20, padding: '14px 16px' }}>📱 폰</div>
            <svg width="250" height="300" viewBox="0 0 560 400" style={{ position: 'absolute', top: 70, left: 0 }}><path d={path} stroke={ACC} strokeWidth="14" fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.min(1, t2 * 1.2) * stroke} /></svg>
          </Device>
        </Card>
      </div>
      <div style={{ position: 'absolute', bottom: 190, display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(16,185,129,.16)', border: `2px solid ${ACC}`, color: ACC, padding: '20px 40px', borderRadius: 99, fontSize: 40, fontWeight: 800, opacity: interpolate(f, [130, 150], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        <span style={{ width: 20, height: 20, borderRadius: 10, background: ACC, boxShadow: `0 0 24px ${ACC}` }} />동기화 켜짐 · 기기 2대
      </div>
    </AbsoluteFill>
  );
};

// ── 씬 3 (420~660f): 기능 2 & 3 팝업 + 데이터 시각화 ───────
const Feature23 = () => {
  const f = useCurrentFrame(); const a = useIn(0); const c1 = useIn(40, { damping: 9, stiffness: 150, mass: 0.7 }); const c2 = useIn(120, { damping: 9, stiffness: 150, mass: 0.7 });
  const bars = [0.35, 0.5, 0.42, 0.7, 0.62, 0.88, 0.95];
  const cnt = Math.round(interpolate(f, [130, 200], [0, 92], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }));
  return (
    <AbsoluteFill style={{ fontFamily: FONT, alignItems: 'center' }}>
      <div style={{ marginTop: 140, textAlign: 'center', opacity: a }}>
        <div style={{ fontSize: 40, color: ACC, fontWeight: 800, letterSpacing: 6 }}>FEATURE 02 · 03</div>
        <div style={{ fontSize: 88, fontWeight: 900, color: TXT, marginTop: 12, letterSpacing: -3 }}>AI가 정리하고,<br />잊을 때 복습시켜요</div>
      </div>
      <div style={{ position: 'absolute', top: 600, width: 900, transform: `scale(${c1}) translateY(${(1 - c1) * 80}px)`, opacity: c1 }}>
        <Card style={{ padding: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}><div style={{ fontSize: 60 }}>🤖</div><div><div style={{ fontSize: 44, fontWeight: 800, color: TXT }}>AI 자동 분류</div><div style={{ fontSize: 30, color: MUTE, marginTop: 6 }}>올리면 카테고리·요약·태그가 자동으로</div></div></div>
          <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>{['토익 LC', '문법', '오답', '요약됨 ✓'].map((t, i) => <span key={t} style={{ background: i === 3 ? 'rgba(16,185,129,.2)' : 'rgba(99,102,241,.22)', color: i === 3 ? ACC : '#C7D2FE', borderRadius: 99, padding: '10px 24px', fontSize: 30, fontWeight: 700, opacity: interpolate(f, [60 + i * 12, 72 + i * 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{t}</span>)}</div>
        </Card>
      </div>
      <div style={{ position: 'absolute', top: 1130, width: 900, transform: `scale(${c2}) translateY(${(1 - c2) * 80}px)`, opacity: c2 }}>
        <Card style={{ padding: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div><div style={{ fontSize: 44, fontWeight: 800, color: TXT }}>🔁 간격 반복 복습</div><div style={{ fontSize: 30, color: MUTE, marginTop: 6 }}>오답을 잊을 때쯤 알려줘요</div></div>
            <div style={{ fontSize: 96, fontWeight: 900, color: ACC, lineHeight: 1 }}>{cnt}<span style={{ fontSize: 40 }}>%</span></div>
          </div>
          <svg width="820" height="230" style={{ marginTop: 20 }}>{bars.map((v, i) => { const h = 200 * v * interpolate(f, [140 + i * 6, 175 + i * 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.6)) }); return <rect key={i} x={i * 120 + 14} y={215 - h} width={80} height={h} rx={18} fill={i === 6 ? ACC : ACC2} opacity={i === 6 ? 1 : 0.75} />; })}</svg>
        </Card>
      </div>
    </AbsoluteFill>
  );
};

// ── 씬 4 (660~900f): 완료 화면 + CTA ──────────────────────
const Finale = () => {
  const f = useCurrentFrame(); const a = useIn(0, { damping: 12, stiffness: 110, mass: 0.9 }); const cta = useIn(70, { damping: 8, stiffness: 140, mass: 0.7 }); const p = usePulse();
  const rows = [['📚 내 파일', '폴더 · 휴지통 · 실시간 공동 편집'], ['🔁 오늘 복습', '12장 · 약 9분'], ['📓 오답노트', 'AI 해설 + 맞춤 퀴즈']];
  return (
    <AbsoluteFill style={{ fontFamily: FONT, alignItems: 'center' }}>
      <div style={{ marginTop: 130, display: 'flex', alignItems: 'center', gap: 28, opacity: a, transform: `scale(${0.8 + a * 0.2})` }}><Logo size={120} /><div style={{ fontSize: 84, fontWeight: 900, color: TXT, letterSpacing: -2 }}>{APP}</div></div>
      <div style={{ position: 'absolute', top: 420, width: 900 }}>
        <Card tilt={interpolate(f, [0, 240], [-8, 4])} style={{ padding: 34 }}>
          {rows.map(([t, s], i) => { const r = useIn(15 + i * 14, { damping: 12, stiffness: 140, mass: 0.7 }); return <div key={t} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '30px 14px', borderBottom: i < 2 ? '1px solid rgba(255,255,255,.1)' : 'none', opacity: r, transform: `translateX(${(1 - r) * 120}px)` }}><div style={{ fontSize: 46, fontWeight: 800, color: TXT }}>{t}</div><div style={{ fontSize: 30, color: MUTE }}>{s}</div></div>; })}
        </Card>
      </div>
      <div style={{ position: 'absolute', top: 1160, textAlign: 'center', opacity: a }}>
        <div style={{ fontSize: 66, fontWeight: 900, color: TXT, lineHeight: 1.3, letterSpacing: -2 }}>PC · 태블릿 · 폰<br /><span style={{ color: ACC }}>하나의 공부 공간</span></div>
      </div>
      <div style={{ position: 'absolute', bottom: 200, transform: `scale(${cta * (1 + p * 0.05)})`, opacity: cta }}>
        <div style={{ background: `linear-gradient(135deg,${ACC2},${ACC})`, color: '#fff', fontSize: 62, fontWeight: 900, padding: '38px 90px', borderRadius: 120, boxShadow: `0 0 ${50 + p * 60}px ${ACC}88, 0 30px 70px rgba(0,0,0,.5)` }}>지금 바로 시작하기</div>
        <div style={{ textAlign: 'center', color: MUTE, fontSize: 32, marginTop: 28 }}>가입 없이 체험 · 무료</div>
      </div>
    </AbsoluteFill>
  );
};

export const Main = () => {
  const f = useCurrentFrame();
  const flash = [180, 420, 660].map((s) => (f >= s ? interpolate(f, [s, s + 10], [0.5, 0], { extrapolateRight: 'clamp' }) : 0)).reduce((a, b) => a + b, 0);
  return (
    <AbsoluteFill>
      <Audio src={staticFile('soundtrack.wav')} />
      <Glow />
      <Sequence from={0} durationInFrames={180}><Intro /></Sequence>
      <Sequence from={180} durationInFrames={240}><Feature1 /></Sequence>
      <Sequence from={420} durationInFrames={240}><Feature23 /></Sequence>
      <Sequence from={660} durationInFrames={240}><Finale /></Sequence>
      <AbsoluteFill style={{ background: '#fff', opacity: flash * 0.35, pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};

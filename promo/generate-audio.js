// 외부 라이브러리 없이 15초 / 120BPM 사운드트랙(WAV)을 수학적으로 합성한다.
const fs = require('fs'), path = require('path');
const SR = 44100, DUR = 15, BPM = 120, BEAT = 60 / BPM; // 0.5초 = 30프레임
const N = SR * DUR, L = new Float32Array(N), R = new Float32Array(N);
const add = (t, f, pan = 0) => { const i0 = Math.floor(t * SR); for (let i = 0; ; i++) { const k = i0 + i; if (k >= N) break; const v = f(i / SR); if (v === null) break; L[k] += v * (1 - Math.max(0, pan)); R[k] += v * (1 + Math.min(0, pan)); } };
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const TAU = Math.PI * 2;

const kick = (t, g = 1) => add(t, (x) => (x > 0.4 ? null : Math.sin(TAU * (48 * x + 90 * (1 - Math.exp(-x * 30)) / 30 * 1)) * Math.exp(-x * 9) * g * 0.95 + (x < 0.006 ? rnd() * 0.3 * g : 0)));
const snare = (t, g = 1) => add(t, (x) => (x > 0.25 ? null : (rnd() * 0.55 * Math.exp(-x * 20) + Math.sin(TAU * 185 * x) * 0.4 * Math.exp(-x * 28)) * g), 0.1);
let hp = 0; const hat = (t, g = 1, open = false) => add(t, (x) => { const d = open ? 0.22 : 0.05; if (x > d * 5) return null; const n = rnd(); const o = n - hp; hp = n * 0.6; return o * Math.exp(-x / d * 3) * 0.22 * g; }, -0.2);
const bass = (t, hz, len = BEAT * 0.9) => add(t, (x) => (x > len ? null : (Math.sin(TAU * hz * x) + 0.35 * Math.sin(TAU * hz * 2 * x + 1)) * Math.min(1, x * 200) * Math.exp(-x * 3.2) * 0.32 * Math.min(1, (len - x) * 60)));
const pluck = (t, hz, g = 1) => add(t, (x) => (x > 0.5 ? null : (Math.sin(TAU * hz * x) + 0.5 * Math.sin(TAU * hz * 2.01 * x)) * Math.exp(-x * 8) * 0.12 * g), 0.3);
const whoosh = (t, len = 0.9, g = 1) => { let lp = 0; add(t - len, (x) => { if (x > len) return null; const p = x / len, c = 0.02 + p * p * 0.6; lp += (rnd() - lp) * c; return lp * Math.sin(Math.PI * p * 0.5 + 0.0) * Math.pow(p, 1.6) * 1.1 * g; }); };
const pop = (t, hz = 880, g = 1) => add(t, (x) => (x > 0.18 ? null : Math.sin(TAU * (hz * x + 200 * (1 - Math.exp(-x * 40)) / 40)) * Math.exp(-x * 22) * 0.35 * g), 0.4);
const clap = (t, g = 1) => add(t, (x) => (x > 0.2 ? null : rnd() * Math.exp(-x * 25) * 0.4 * g));

const notes = { A1: 55, C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98 };
const line = ['A1', 'A1', 'C2', 'A1', 'D2', 'D2', 'E2', 'G2']; // 4마디 진행(박 단위)
const scenes = [3, 7, 11]; // 전환 시점(초)
const beats = Math.floor(DUR / BEAT);
for (let b = 0; b < beats; b++) {
  const t = b * BEAT, sec = t, fill = scenes.some((s) => sec >= s - 1 && sec < s); // 전환 직전 1초는 드럼 필인
  const intro = sec < 3, build = sec >= 11 ? 1.1 : 1;
  kick(t, build);                                       // 매 정박 킥
  if (b % 2 === 1 && !fill) snare(t, 0.9);              // 백비트 스네어
  if (!intro || b >= 2) { hat(t + BEAT / 2, 0.9, true); hat(t, 0.6); hat(t + BEAT / 4, 0.4); hat(t + BEAT * 0.75, 0.5); }
  if (b >= 2) bass(t + BEAT / 2, notes[line[b % 8]] ?? 55, BEAT * 0.45);
  if (sec >= 3) { pluck(t + BEAT / 4, 440 * (b % 4 === 0 ? 1 : b % 4 === 1 ? 1.25 : b % 4 === 2 ? 1.5 : 1.335)); }
  if (fill) { for (let k = 0; k < 4; k++) snare(t + k * BEAT / 4 * (BEAT <= 0.5 ? 1 : 1), 0.45 + 0.15 * k + (sec % 1 > 0.4 ? 0.2 : 0)); }
}
for (const s of [0, 3, 7, 11]) { if (s > 0) whoosh(s, 0.9); pop(s, 700 + s * 40); clap(s, 0.8); kick(s, 1.15); }
for (const s of [4.5, 5.5, 8, 9, 10, 13]) pop(s, 1000 + s * 30, 0.7); // 화면 요소 팝업
clap(14, 0.9); kick(14, 1.2); kick(14.5, 1.2);

// 사이드체인 느낌: 킥 직후 위 레이어 살짝 눌러줌 → 단순 마스터 리미터
let peak = 0; for (let i = 0; i < N; i++) { const f = i < 441 ? i / 441 : i > N - SR * 0.4 ? (N - i) / (SR * 0.4) : 1; L[i] *= f; R[i] *= f; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const gain = 0.92 / Math.max(peak, 0.001);
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { data.writeInt16LE(Math.round(Math.tanh(L[i] * gain * 1.1) * 32000), i * 4); data.writeInt16LE(Math.round(Math.tanh(R[i] * gain * 1.1) * 32000), i * 4 + 2); }
const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
const out = path.join(__dirname, 'public', 'soundtrack.wav'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.concat([h, data]));
console.log('생성 완료:', out, (data.length / 1e6 + 0.04).toFixed(1) + 'MB', 'peak', peak.toFixed(2));

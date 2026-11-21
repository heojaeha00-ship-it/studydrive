import { Composition } from 'remotion';
import { Main } from './Main';

// 15초 · 60fps = 900프레임. 120BPM → 1박 = 0.5초 = 30프레임.
export const Root = () => <Composition id="Promo" component={Main} durationInFrames={900} fps={60} width={1080} height={1920} />;

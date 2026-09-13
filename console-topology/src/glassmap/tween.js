// 极简补间：每帧由渲染循环驱动，所有动效在同一时钟上推进
export const Ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};
const active = new Set();
export function tween(obj, to, { duration = 0.5, delay = 0, ease = Ease.outCubic, onUpdate, onComplete } = {}) {
  const from = {}; for (const k of Object.keys(to)) from[k] = obj[k];
  const tw = { obj, from, to, t: -delay, duration, ease, onUpdate, onComplete, done: false, cancel() { active.delete(tw); tw.done = true; } };
  active.add(tw); return tw;
}
export function updateTweens(dt) {
  for (const tw of active) {
    tw.t += dt; if (tw.t < 0) continue;
    const k = tw.duration <= 0 ? 1 : Math.min(1, tw.t / tw.duration), e = tw.ease(k);
    for (const key of Object.keys(tw.to)) tw.obj[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
    tw.onUpdate?.(e);
    if (k >= 1) { active.delete(tw); tw.done = true; tw.onComplete?.(); }
  }
}
export const lerp = (a, b, k) => a + (b - a) * k;
// 帧率无关的平滑趋近：每秒收敛 speed 倍
export const approach = (cur, target, speed, dt) => cur + (target - cur) * (1 - Math.exp(-speed * dt));

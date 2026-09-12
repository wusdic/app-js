// 极简补间：无外部依赖，供相机、材质、缩放动画使用
const active = new Set();

export const Ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

export function tween(obj, to, { duration = 1, delay = 0, ease = Ease.outCubic, onUpdate, onComplete } = {}) {
  const from = {};
  for (const k in to) from[k] = obj[k];
  const tw = { obj, from, to, duration, delay, ease, onUpdate, onComplete, t: -delay, done: false };
  tw.cancel = () => active.delete(tw);
  active.add(tw);
  return tw;
}

export function tweenValue(from, to, opts, onUpdate) {
  const holder = { v: from };
  return tween(holder, { v: to }, { ...opts, onUpdate: () => onUpdate(holder.v) });
}

export function updateTweens(dt) {
  for (const tw of active) {
    tw.t += dt;
    if (tw.t < 0) continue;
    const p = Math.min(1, tw.t / tw.duration);
    const e = tw.ease(p);
    for (const k in tw.to) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
    tw.onUpdate?.(e);
    if (p >= 1) { active.delete(tw); tw.done = true; tw.onComplete?.(); }
  }
}

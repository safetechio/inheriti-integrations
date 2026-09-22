const HUES = [
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316',
  '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
];
const RADII = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
const X = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const Y = [0.3, 0.4, 0.5, 0.6, 0.7];

function hash32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function seededRng(input: string): () => number {
  let seed = hash32(input);
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function planAvatarSvg(planId: string): string {
  const identity = planId || 'empty';
  const random = seededRng(`${identity}-fill`);
  const colors = [...HUES];
  for (let index = colors.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [colors[index], colors[other]] = [colors[other]!, colors[index]!];
  }
  const pick = (values: number[]) => values[Math.floor(random() * values.length)]!;
  const blobs = Array.from({ length: 3 }, (_, index) => {
    const radius = pick(RADII) * 90;
    const x = pick(X) * 90;
    const y = pick(Y) * 90;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${colors[index + 1]}" style="mix-blend-mode:soft-light"/>`;
  }).join('');
  const artId = `ma${hash32(identity).toString(36)}_art`;
  const path = 'M 35.0 20.0 L 65.0 20.0 A 15 15 0 0 1 80.0 35.0 L 80.0 65.0 A 15 15 0 0 1 65.0 80.0 L 35.0 80.0 A 15 15 0 0 1 20.0 65.0 L 20.0 35.0 A 15 15 0 0 1 35.0 20.0 Z';
  return `<svg class="mosaic-avatar" viewBox="16 16 68 68" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="${artId}" patternUnits="userSpaceOnUse" x="5.0" y="5.0" width="90.0" height="90.0"><rect width="90.0" height="90.0" fill="${colors[0]}"/>${blobs}</pattern></defs><path d="${path}" fill="url(#${artId})"/></svg>`;
}

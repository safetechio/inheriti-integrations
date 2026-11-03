// @ts-nocheck — verbatim Business mosaic geometry; preserve its SVG paths.
export interface MosaicTile {
    path: string;
    dx: number;
    dy: number;
}

export interface MosaicArtwork {
    defs: string;
    fills: string[];
}

/** The assembled square a mosaic's tiles are cut from, in the caller's user space. */
export interface MosaicSquare {
    cx: number;
    cy: number;
    half: number;
}

export type Rng = () => number;

/** Seeded per-plan palette so each plan renders a stable, unique tile fingerprint. */
const HUES = [
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316',
    '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9'
];

const BLUES = [
    '#1642BA', '#2962FF', '#4f8bf5', '#3b82f6', '#1d4ed8', '#2563eb',
    '#60a5fa', '#1e40af', '#0ea5e9', '#0284c7', '#4338ca', '#3b6ef0'
];

export function hash32(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mul32(seed: number): Rng {
    let a = seed;
    return function next() {
        a += 0x6d2b79f5;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function seededRng(identity: string): Rng {
    return mul32(hash32(identity));
}

export function shuffle<T>(items: T[], rnd: Rng): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function edgeTab(x0: number, y0: number, x1: number, y1: number, sign: number): string {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const nx = (dy / len) * sign;
    const ny = (-dx / len) * sign;
    const ax = x0 + dx * 0.3;
    const ay = y0 + dy * 0.3;
    const bx = x0 + dx * 0.7;
    const by = y0 + dy * 0.7;
    const h = len * 0.3;
    return `L ${ax.toFixed(1)} ${ay.toFixed(1)} C ${(ax + nx * h).toFixed(1)} ${(ay + ny * h).toFixed(1)}, ${(bx + nx * h).toFixed(1)} ${(by + ny * h).toFixed(1)}, ${bx.toFixed(1)} ${by.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export function polarRing(radius: number, deg: number, center: number): { x: number; y: number } {
    const a = ((deg - 90) * Math.PI) / 180;
    return { x: center + Math.cos(a) * radius, y: center + Math.sin(a) * radius };
}

export function describeArc(radius: number, s: number, e: number, center: number): string {
    const a = polarRing(radius, s, center);
    const b = polarRing(radius, e, center);
    const sweep = (e - s + 360) % 360;
    const large = sweep > 180 ? 1 : 0;
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export function describeArcR(radius: number, s: number, e: number, center: number): string {
    const a = polarRing(radius, s, center);
    const b = polarRing(radius, e, center);
    const sweep = (e - s + 360) % 360;
    const large = sweep > 180 ? 1 : 0;
    return `M ${b.x.toFixed(1)} ${b.y.toFixed(1)} A ${radius} ${radius} 0 ${large} 0 ${a.x.toFixed(1)} ${a.y.toFixed(1)}`;
}

/** Four interlocking tiles around a central hub of radius `hc`. */
export function buildTiles(cx: number, cy: number, H: number, hc = 0): MosaicTile[] {
    const r = H * 0.5;
    const A = [cx - H, cy - H];
    const B = [cx, cy - H];
    const D = [cx + H, cy - H];
    const E = [cx + H, cy];
    const F = [cx + H, cy + H];
    const Gp = [cx, cy + H];
    const K = [cx - H, cy + H];
    const Lp = [cx - H, cy];
    const O = [cx, cy];
    const P = (p: number[]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    const n = (v: number) => v.toFixed(1);
    const et = (a: number[], b: number[], s: number) => edgeTab(a[0], a[1], b[0], b[1], s);
    const hT = [cx, cy - hc];
    const hB = [cx, cy + hc];
    const hL = [cx - hc, cy];
    const hR = [cx + hc, cy];
    const arc = (t: number[]) => `A ${hc} ${hc} 0 0 0 ${n(t[0])} ${n(t[1])}`;
    const on = hc > 0;

    const TL = `M ${n(A[0] + r)} ${n(A[1])} L ${P(B)} ${et(B, on ? hT : O, 1)} ${on ? arc(hL) : ''} ${et(on ? hL : O, Lp, 1)} L ${n(A[0])} ${n(A[1] + r)} A ${r} ${r} 0 0 1 ${n(A[0] + r)} ${n(A[1])} Z`;
    const TR = `M ${P(B)} L ${n(D[0] - r)} ${n(D[1])} A ${r} ${r} 0 0 1 ${n(D[0])} ${n(D[1] + r)} L ${P(E)} ${et(E, on ? hR : O, 1)} ${on ? arc(hT) : ''} ${et(on ? hT : O, B, -1)} Z`;
    const BL = `M ${P(Lp)} ${et(Lp, on ? hL : O, -1)} ${on ? arc(hB) : ''} ${et(on ? hB : O, Gp, 1)} L ${n(K[0] + r)} ${n(K[1])} A ${r} ${r} 0 0 1 ${n(K[0])} ${n(K[1] - r)} L ${P(Lp)} Z`;
    const BR = `M ${on ? `${n(hR[0])} ${n(hR[1])}` : P(O)} ${et(on ? hR : O, E, -1)} L ${n(F[0])} ${n(F[1] - r)} A ${r} ${r} 0 0 1 ${n(F[0] - r)} ${n(F[1])} L ${P(Gp)} ${et(Gp, on ? hB : O, -1)} ${on ? arc(hR) : ''} Z`;

    return [
        { path: TL, dx: -1, dy: -1 },
        { path: TR, dx: 1, dy: -1 },
        { path: BL, dx: -1, dy: 1 },
        { path: BR, dx: 1, dy: 1 }
    ];
}

/** The assembled square's outer edge as one continuous rounded square — the silhouette `buildTiles` cuts up. */
export function buildSilhouette(cx: number, cy: number, H: number): string {
    const r = H * 0.5;
    const n = (v: number) => v.toFixed(1);
    const l = cx - H;
    const t = cy - H;
    const rt = cx + H;
    const b = cy + H;
    const arc = (x: number, y: number) => `A ${r} ${r} 0 0 1 ${n(x)} ${n(y)}`;
    return `M ${n(l + r)} ${n(t)} L ${n(rt - r)} ${n(t)} ${arc(rt, t + r)} L ${n(rt)} ${n(b - r)} ${arc(rt - r, b)} L ${n(l + r)} ${n(b)} ${arc(l, b - r)} L ${n(l)} ${n(t + r)} ${arc(l + r, t)} Z`;
}

/**
 * Blob placement, as fractions of the painted rect. Three large overlapping circles over a solid ground,
 * soft-light blended — the arrangement vechain/picasso uses to get a continuous multi-color wash rather
 * than a readable set of discs.
 */
const BLOB_RADII = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
const BLOB_CX = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const BLOB_CY = [0.3, 0.4, 0.5, 0.6, 0.7];
const BLOB_COUNT = 3;

/**
 * The painted rect runs wider than the square itself: a pattern repeats where the geometry overruns it, and
 * the interlock tabs from `edgeTab` bulge past the nominal edges. Overpainting is free — tiles only ever
 * sample the slice under them — while a repeat is a visible seam.
 */
const ART_PAD = 0.5;

/**
 * One painting spanning the whole assembled square, handed to every tile as the same fill.
 *
 * Both halves of that matter. A gradient per tile restarts at each piece; so does a single shared gradient,
 * because `gradientUnits` defaults to `objectBoundingBox` and renormalizes to whatever path references it.
 * Painting into a `userSpaceOnUse` pattern instead makes each tile show the part of the artwork that sits
 * under it, so the pieces read as cuts from one image — and because the pattern resolves in the referencing
 * element's user space, a piece that slides out carries its slice with it and re-registers on the way back.
 */
export function makeArtwork(rnd: Rng, prefix: string, square: MosaicSquare, palette?: string[]): MosaicArtwork {
    const cols = shuffle(palette ?? HUES, rnd);
    const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)];
    const n = (v: number) => v.toFixed(1);

    const pad = square.half * ART_PAD;
    const size = (square.half + pad) * 2;
    const x = square.cx - square.half - pad;
    const y = square.cy - square.half - pad;

    // Pattern content draws from the tile's own origin, so the artwork is laid out at 0,0 — x/y below are
    // what anchor it onto the square in user space.
    const blobs = Array.from({ length: BLOB_COUNT }, (_, i) => {
        const r = pick(BLOB_RADII) * size;
        const bx = pick(BLOB_CX) * size;
        const by = pick(BLOB_CY) * size;
        return `<circle cx="${n(bx)}" cy="${n(by)}" r="${n(r)}" fill="${cols[(i + 1) % cols.length]}" style="mix-blend-mode:soft-light"/>`;
    }).join('');

    const id = `${prefix}art`;
    const defs = `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}"><rect width="${n(size)}" height="${n(size)}" fill="${cols[0]}"/>${blobs}</pattern>`;

    return { defs, fills: Array(4).fill(`url(#${id})`) };
}

export { HUES, BLUES };

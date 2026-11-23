import type { GuideStage } from '../content';

const dismissedInMemory = new Set<GuideStage>();
const key = (stage: GuideStage) => `importer.quick-guide.dismissed.${stage}.v1`;

export function wasGuideDismissed(stage: GuideStage) {
  try {
    return localStorage.getItem(key(stage)) === '1' || dismissedInMemory.has(stage);
  } catch {
    return dismissedInMemory.has(stage);
  }
}

export function rememberGuideDismissal(stage: GuideStage) {
  try {
    localStorage.setItem(key(stage), '1');
  } catch {
    dismissedInMemory.add(stage);
    // Preferences can be unavailable; keep the dismissal for this app session.
  }
}

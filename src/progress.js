import { LEVEL_IDS } from "./levels.js";

export const PROGRESS_STORAGE_KEY = "unit0-progress";
export const PROGRESS_VERSION = 1;

export function createDefaultProgress() {
  return { version: PROGRESS_VERSION, completedLevelIds: [], lastPlayedLevelId: null, introSeen: false };
}

function storageOrNull(storage) {
  if (storage !== undefined) return storage || null;
  try { return globalThis.localStorage || null; } catch { return null; }
}

function validIdSet(levelIds = LEVEL_IDS) {
  return Array.isArray(levelIds) && levelIds.length ? new Set(levelIds) : null;
}

export function isValidProgress(value, levelIds = LEVEL_IDS) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== PROGRESS_VERSION) return false;
  if (!Array.isArray(value.completedLevelIds) || typeof value.introSeen !== "boolean") return false;
  if (!(value.lastPlayedLevelId === null || Number.isInteger(value.lastPlayedLevelId))) return false;
  const ids = validIdSet(levelIds);
  const completed = new Set();
  for (const id of value.completedLevelIds) {
    if (!Number.isInteger(id) || (ids && !ids.has(id)) || completed.has(id)) return false;
    completed.add(id);
  }
  return !ids || (value.lastPlayedLevelId === null || ids.has(value.lastPlayedLevelId));
}

export function loadProgress(storage, levelIds = LEVEL_IDS) {
  const fallback = createDefaultProgress();
  const source = storageOrNull(storage);
  if (!source) return fallback;
  let raw;
  try { raw = source.getItem(PROGRESS_STORAGE_KEY); } catch { return fallback; }
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidProgress(parsed, levelIds)) return fallback;
    return {
      version: PROGRESS_VERSION,
      completedLevelIds: [...parsed.completedLevelIds],
      lastPlayedLevelId: parsed.lastPlayedLevelId,
      introSeen: parsed.introSeen,
    };
  } catch { return fallback; }
}

export function saveProgress(progress, storage, levelIds = LEVEL_IDS) {
  if (!isValidProgress(progress, levelIds)) return false;
  const target = storageOrNull(storage);
  if (!target) return false;
  try {
    target.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({
      version: PROGRESS_VERSION,
      completedLevelIds: [...progress.completedLevelIds],
      lastPlayedLevelId: progress.lastPlayedLevelId,
      introSeen: progress.introSeen,
    }));
    return true;
  } catch { return false; }
}

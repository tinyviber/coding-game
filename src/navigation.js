import { LEVEL_IDS } from "./levels.js";

export const LEVEL_ROUTE_PREFIX = "#/level/";

function validIds(levelIds = LEVEL_IDS) {
  return new Set(Array.isArray(levelIds) ? levelIds.filter((id) => Number.isInteger(id)) : []);
}

export function levelRoute(levelId) {
  return LEVEL_IDS.includes(levelId) ? `${LEVEL_ROUTE_PREFIX}${levelId}` : "";
}

export function parseLevelRoute(hash, levelIds = LEVEL_IDS) {
  if (typeof hash !== "string") return null;
  const match = /^#\/level\/([1-9]\d*)$/.exec(hash);
  if (!match) return null;
  const id = Number(match[1]);
  return validIds(levelIds).has(id) ? id : null;
}

export function isLevelRoute(hash, levelIds = LEVEL_IDS) {
  return parseLevelRoute(hash, levelIds) !== null;
}

export function routeForLevel(levelId) {
  return levelRoute(levelId);
}

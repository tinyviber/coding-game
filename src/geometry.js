export function edgeControlPoints(from, to) {
  if (Math.abs(to.y - from.y) <= 0.08) return { from, to, curved: false };
  return {
    from,
    to,
    curved: true,
    c1: { x: from.x + (to.x - from.x) * 0.45, y: from.y },
    c2: { x: from.x + (to.x - from.x) * 0.55, y: to.y },
  };
}

export function pointOnEdge(edge, t) {
  const p = Math.max(0, Math.min(1, t));
  if (!edge.curved) {
    return {
      x: edge.from.x + (edge.to.x - edge.from.x) * p,
      y: edge.from.y + (edge.to.y - edge.from.y) * p,
    };
  }
  const inv = 1 - p;
  return {
    x: inv ** 3 * edge.from.x + 3 * inv ** 2 * p * edge.c1.x + 3 * inv * p ** 2 * edge.c2.x + p ** 3 * edge.to.x,
    y: inv ** 3 * edge.from.y + 3 * inv ** 2 * p * edge.c1.y + 3 * inv * p ** 2 * edge.c2.y + p ** 3 * edge.to.y,
  };
}

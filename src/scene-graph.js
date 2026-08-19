// Scene graph helpers shared by Runtime.  Scene edges are intentionally
// directed: a visual traversal is legal only when the authored scene says it
// is legal.

function edgeParts(edge) {
  if (Array.isArray(edge)) return { from: edge[0], to: edge[1] };
  return { from: edge?.from, to: edge?.to };
}

export function nodeMap(scene) {
  return new Map((scene?.nodes || []).map((node) => [node.id, node]));
}

export function resolveNodeId(scene, id) {
  return id;
}

export function authoredEdges(scene) {
  return (scene?.edges || [])
    .map(edgeParts)
    .filter((edge) => typeof edge.from === "string" && typeof edge.to === "string");
}

export function isAuthoredEdge(scene, from, to) {
  return authoredEdges(scene).some((edge) => edge.from === from && edge.to === to);
}

export function findPath(scene, from, to) {
  const start = resolveNodeId(scene, from);
  const goal = resolveNodeId(scene, to);
  const nodes = nodeMap(scene);
  if (!nodes.has(start) || !nodes.has(goal)) return null;
  if (start === goal) return [start];

  const adjacency = new Map();
  for (const edge of authoredEdges(scene)) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }

  const queue = [start];
  const previous = new Map([[start, null]]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const next of adjacency.get(current) || []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === goal) {
        const path = [goal];
        let step = current;
        while (step !== null) {
          path.push(step);
          step = previous.get(step);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

export function pathEdges(scene, path) {
  if (!Array.isArray(path) || path.length < 2) return [];
  const edges = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const edge = { from: path[index], to: path[index + 1] };
    if (!isAuthoredEdge(scene, edge.from, edge.to)) return null;
    edges.push(edge);
  }
  return edges;
}

export function findEdgePath(scene, from, to) {
  const path = findPath(scene, from, to);
  if (!path) return null;
  const edges = pathEdges(scene, path);
  return edges === null ? null : { nodes: path, edges };
}

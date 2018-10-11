import PeerGraph from './PeerGraph';
import Edge from './Edge';
import PeerNode from './PeerNode';

export const Graph = new PeerGraph();

export function addNode(nodeId) {
  const node = new PeerNode(nodeId);
  Graph.addNode(node);
}

export function addConnection(node1Id, node2Id, latency = 0) {
  const nodeA = Graph.getNodeById(node1Id) || new PeerNode(node1Id);
  const nodeB = Graph.getNodeById(node2Id) || new PeerNode(node2Id);
  const edgeAB = new Edge(nodeA, nodeB, latency);
  console.log('ADDED CONNECTION', node1Id, node2Id, latency);
  console.log(Graph.nodes);
  console.log(Graph.edges);
  return Graph.addEdge(edgeAB);
}

export function removeConnection(node1Id, node2Id) {
  const nodeA = Graph.getNodeById(node1Id);
  const nodeB = Graph.getNodeById(node2Id);
  if (nodeA && nodeB) Graph.deleteEdge(Graph.findEdge(nodeA, nodeB));
}

export function getPeerLatencies(nodeId) {
  const node = Graph.findNodeById(nodeId);
  if (node) {
    const result = {};
    const edges = node.getEdges();
    edges.forEach((e) => {
      const id = e.node1.getId() === nodeId ? e.node2.getId() : e.node1.getId();
      const latency = e.getWeight();
      result[id] = latency;
    });
    return result;
  }
}

export function getConnectedPeers(nodeId) {
  const node = Graph.getNodeById(nodeId);
  const neighbors = node.getNeighbors();
  return neighbors.map(n => n.getId());
}

export function average(vals) {
  const total = vals.reduce((sum, val) => val + sum);
  return total / vals.length;
}

export function squaredDiffs(vals, avg) {
  const sqd = vals.map(val => (val - avg) ** 2);
  return sqd;
}

export function stdDeviation(sqDiffs) {
  const sum = sqDiffs.reduce((total, x) => total + x);
  return Math.sqrt(sum / sqDiffs.length);
}

export function getLatencyZScores(nodeId) {
  const peerLatencyCache = getPeerLatencies(nodeId);
  const peerIds = Object.keys(peerLatencyCache);
  const peerLatencies = Object.values(peerLatencyCache);
  const avg = average(peerLatencies);
  const standardDeviation = stdDeviation(squaredDiffs(peerLatencies, avg));
  const zScores = {};
  peerIds.forEach((val, i) => {
    zScores[val] = (peerLatencies[i] - avg) / standardDeviation;
  });
  return zScores;
}

export function getDroppablePeer(nodeId) {
  const zScores = getLatencyZScores(nodeId);
  const droppable = zScores.filter(s => s <= -1);
  const orderedDroppable = droppable.sort((a, b) => b - a);
  return orderedDroppable[0];
}

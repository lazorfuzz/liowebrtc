export default class PeerGraph {
  constructor() {
    this.nodes = {};
    this.edges = {};
    this.edgeCount = 0;
  }

  addEdge(edge) {
    let node1 = this.getNodeById(edge.node1.getId());
    let node2 = this.getNodeById(edge.node2.getId());
    if (!node1) {
      this.addNode(edge.node1);
      node1 = this.getNodeById(edge.node1.getId());
    }
    if (!node2) {
      this.addNode(edge.node2);
      node2 = this.getNodeById(edge.node2.getId());
    }

    if (this.edges[edge.getId()]) {
      // throw new Error('Edge already exists');
    } else {
      this.edges[edge.getId()] = edge;
    }
    // Add edge to both node instances because it's an undirected graph
    node1.addEdge(edge);
    node2.addEdge(edge);
    return this;
  }

  addNode(newNode) {
    this.nodes[newNode.getId()] = newNode;
    return this;
  }

  getNodeById(id) {
    return this.nodes[id];
  }

  getNeighbors(node) {
    return node.getNeighbors();
  }

  getWeight() {
    return this.getAllEdges().reduce((weight, edge) => weight + edge.weight, 0);
  }

  getAllNodes() {
    return Object.values(this.nodes);
  }

  getAllEdges() {
    return Object.values(this.edges);
  }

  findNodeById(nodeId) {
    if (this.nodes[nodeId]) {
      return this.nodes[nodeId];
    }
    return null;
  }

  findEdge(node1, node2) {
    const node = this.getNodeById(node1.getId());
    if (!node) {
      return null;
    }
    return node.findEdge(node2);
  }

  deleteEdge(edge) {
    if (!edge) {
      return;
    }
    if (this.edges[edge.getId()]) {
      delete this.edges[edge.getId()];
    }
    const node1 = this.getNodeById(edge.node1.getId());
    const node2 = this.getNodeById(edge.node2.getId());
    node1.deleteEdge(edge);
    node2.deleteEdge(edge);
  }

  getNodeIndices() {
    const nodeIndices = {};
    this.getAllNodes().forEach((node, index) => {
      nodeIndices[node.getId()] = index;
    });
    return nodeIndices;
  }

  toString() {
    return Object.keys(this.nodes).toString();
  }

  toJSON() {

  }
}

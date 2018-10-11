export default class Node {
  constructor(value) {
    if (value === undefined) {
      throw new Error('Node must have an ID');
    }
    this.value = value;
    this.edges = {};
  }

  addEdge(edge) {
    this.edges[edge.getId()] = edge;
    return this;
  }

  deleteEdge(edge) {
    delete this.edges[edge.getId()];
  }

  getEdges() {
    return Object.values(this.edges);
  }

  getDegree() {
    return Object.keys(this.edges).length;
  }

  getNeighbors() {
    const edges = Object.values(this.edges);
    const nodes = edges.map(e => (e.node1 === this ? e.node2 : e.node1));
    return nodes;
  }

  hasEdge(requiredEdge) {
    const edgeNode = this.edges.filter(edge => edge.getId() === requiredEdge.getId());
    return !!edgeNode.length;
  }

  hasNeighbor(node) {
    const nodeWeWant = Object.values(this.edges).filter(e => e.node1.getId() === node.getId() || e.node2.getId() === node.getId());
    return !!nodeWeWant.length;
  }

  findEdge(node) {
    const result = Object.values(this.edges).filter(e => e.node1.getId() === node.getId() || e.node2.getId() === node.getId());
    return result.length ? result[0] : null;
  }

  getId() {
    return this.value;
  }

  deleteAllEdges() {
    this.getEdges().forEach(e => this.deleteEdge(e));
    return this;
  }

  toString() {
    return `${this.value}`;
  }
}

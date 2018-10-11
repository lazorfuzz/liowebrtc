export default class Edge {
  constructor(startNode, endNode, weight = 0) {
    this.node1 = startNode;
    this.node2 = endNode;
    this.weight = weight;
  }

  getId() {
    const startNodeId = this.node1.getId();
    const endNodeId = this.node2.getId();
    return `${startNodeId}_${endNodeId}`;
  }

  getWeight() {
    return this.weight;
  }

  setWeight(weight) {
    this.weight = weight;
  }

  reverse() {
    const tmp = this.node1;
    this.node1 = this.node2;
    this.node2 = tmp;
  }

  toString() {
    return this.getId();
  }
}

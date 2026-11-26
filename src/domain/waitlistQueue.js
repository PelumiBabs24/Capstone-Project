class Node {
  constructor(value) {
    this.value = value;
    this.next = null;
  }
}

export class Queue {
  #head = null;
  #tail = null;
  #size = 0;

  get size() {
    return this.#size;
  }

  enqueue(value) {
    const node = new Node(value);
    if (this.#tail) {
      this.#tail.next = node;
    } else {
      this.#head = node;
    }
    this.#tail = node;
    this.#size += 1;
  }

  dequeue() {
    if (!this.#head) return undefined;

    const value = this.#head.value;
    this.#head = this.#head.next;
    if (!this.#head) this.#tail = null;
    this.#size -= 1;
    return value;
  }

  peek() {
    return this.#head?.value;
  }

  toArray() {
    const values = [];
    let node = this.#head;
    while (node) {
      values.push(node.value);
      node = node.next;
    }
    return values;
  }
}

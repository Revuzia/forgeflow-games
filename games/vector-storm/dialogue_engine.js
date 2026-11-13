/**
 * dialogue_engine.js — Point-and-click / visual novel dialogue system.
 * Monkey Island, Broken Sword, Phoenix Wright, visual novels.
 *
 * API:
 *   const dlg = new DialogueEngine({tree, onChoice, onEnd});
 *   dlg.start(sceneOrContainer);
 *   dlg.choose(idx);
 *
 * tree format: nested node graph
 *   {start: "intro",
 *    nodes: {
 *      intro: {speaker, portrait, text, choices: [{text, goto: "node_id", set_flag: "x"}]},
 *      outro: {speaker, text, end: true}
 *    },
 *    flags: {}}
 */
class DialogueEngine {
  constructor(config) {
    this.tree = config.tree;
    this.currentNode = this.tree.start;
    this.flags = { ...(this.tree.flags || {}) };
    this.onChoice = config.onChoice || (() => {});
    this.onEnd = config.onEnd || (() => {});
    this.history = [];
    this.scene = null;
  }

  current() { return this.tree.nodes[this.currentNode]; }

  _evalCondition(cond) {
    if (!cond) return true;
    if (cond.has_flag) return !!this.flags[cond.has_flag];
    if (cond.not_flag) return !this.flags[cond.not_flag];
    return true;
  }

  choose(choiceIdx) {
    const node = this.current();
    if (!node || !node.choices) return;
    const c = node.choices[choiceIdx];
    if (!c || !this._evalCondition(c.condition)) return;
    if (c.set_flag) this.flags[c.set_flag] = true;
    if (c.clear_flag) this.flags[c.clear_flag] = false;
    this.history.push(this.currentNode);
    this.onChoice(c);
    if (c.goto) {
      this.currentNode = c.goto;
      const next = this.current();
      if (next && next.end) this.onEnd(this.flags);
      this._render();
    }
  }

  start(sceneOrContainer) {
    this.scene = sceneOrContainer;
    this._render();
  }

  _render() {
    const node = this.current();
    if (!node) return;
    if (this.renderer) this.renderer(node, this.flags, (i) => this.choose(i));
  }
}
if (typeof window !== "undefined") window.DialogueEngine = DialogueEngine;

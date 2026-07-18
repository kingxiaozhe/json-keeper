// 防护网 — 搜索高亮的生命周期（T-201，feature 3 前置）。
//
// feature 3 的 T-206 会加 `jk-invalid`（校验错误标红），它可能和搜索的 `jk-current`/`jk-dim`
// **同时命中一行**。这里先把搜索高亮的现状锁死：命中打 jk-current、非命中打 jk-dim、清空全撤。
// 那样 T-206 加 jk-invalid 后，一旦它误清了搜索的类（或反之），这些测试会变红 —— 正交性的锚。
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDOM, makeMount, installChrome } from "./_dom.mjs";
import { loadJK } from "./_load.mjs";

installDOM();
const JK = loadJK();

const mount = (json) => {
  const c = installChrome({});
  const root = makeMount();
  JK.mountViewer(root, JSON.stringify(json), { showErrors: false });
  return { root, done: () => c.uninstall() };
};
const rows = (root) => {
  const holder = root.querySelector("[data-pretty]").children[0];
  return holder ? holder.children.filter((r) => r._apath !== undefined) : [];
};
const search = (root, q) => {
  const inp = root.querySelector(".jk-search input");
  inp.value = q;
  (inp._ls.input || []).forEach((f) => f({ target: inp }));
};

test("搜索命中：命中行 jk-current、非命中行 jk-dim", () => {
  const { root, done } = mount({ alpha: 1, beta: 2, gamma: 3 });
  try {
    search(root, "alpha");
    const cur = rows(root).filter((r) => r.classList.contains("jk-current"));
    const dim = rows(root).filter((r) => r.classList.contains("jk-dim"));
    assert.equal(cur.length, 1, "命中行打 jk-current");
    assert.ok(dim.length > 0, "非命中行打 jk-dim");
    assert.ok(!cur[0].classList.contains("jk-dim"), "命中行不该同时 dim");
  } finally { done(); }
});

test("清空搜索：jk-current / jk-dim 全撤（T-206 的 markInvalid 不许残留它们）", () => {
  const { root, done } = mount({ alpha: 1, beta: 2 });
  try {
    search(root, "alpha");
    search(root, "");
    const tainted = rows(root).filter((r) => r.classList.contains("jk-current") || r.classList.contains("jk-dim"));
    assert.equal(tainted.length, 0, "清空后没有任何行残留搜索高亮类");
  } finally { done(); }
});

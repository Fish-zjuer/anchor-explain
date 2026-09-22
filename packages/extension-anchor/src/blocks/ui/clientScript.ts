/**
 * 块流视图的客户端脚本（**字符串常量**：内联进 HTML，见 html.ts）。
 *
 * @anchor 面板只做两件事：**把宿主给的模型画出来** + **把用户动作发回去**。
 *         队列的真相在宿主那边（和侧边栏同一条纪律："谁发命令谁承担能不能发的判断"），
 *         所以这里不维护任何选中状态 —— 状态只有一份，就不会出现"界面上的号码
 *         和发出去的不一致"。
 *
 * 鼠标动作四件（用户要的"滑选连续选择一段东西"落在第三条）：
 *
 *   - **点一下**：加入队列 / 再点一下移出（带"按下去弹回来"的动效）；
 *   - **Shift + 点**：从上一次点到的那块连选到这块；
 *   - **按住拖过几块**：起点到当前块连成一段（这是"滑选"）；
 *   - **悬停**：全部交给 CSS（只换边框色），脚本一个字都不管。
 *
 * ## 这里**没有**任何几何（D115）
 *
 * D111~D114 时这里还有一段"视线跟随"：悬停时往那块砖上写两个变量（`--eye-x` / `--eye-y`），
 * 坑口下面那片底面照着它转。用户看完的判词是"**去掉后面的所有设计吧，你根本实现不了我的想法，
 * 那都去掉吧，只留相册设计**"，于是整段删掉 ——
 * 连同 `EYE_MAX`、量 rect、rAF 合帧、减少动效的那道早退。
 *
 * 所以本文件里**不许再出现** transform / rotate / matrix / perspective，
 * 也不许出现那两个变量（`test/blockView.test.ts` 盯着这条）。
 * 想改观感就改 styles.ts —— 这里没有第二份几何，也没有第二个真相。
 *
 * 注意：本文件里**不许出现反引号和 `${`** —— 它整个是一个 TS 模板字符串的子串，
 * 出现就会被拼坏（`test/startUi.test.ts` 就是为这一类白屏事故立的规矩）。
 */

export const BLOCK_VIEW_CLIENT_SCRIPT = `
(function () {
  var root = document.getElementById("root");
  if (!root) return;

  var vscode = null;
  try { vscode = acquireVsCodeApi(); } catch (e) { vscode = null; }
  function post(msg) { if (vscode) vscode.postMessage(msg); }

  /* ── 重画之后把滚动位置捡回来 ────────────────────────────────
     宿主每次状态变化都**重设整个 HTML**（真相只有一份，见 BlockStreamPanel 的注释）。
     不捡的话，点第 40 块时画面会跳回顶上 —— 那不是"纪律"，那是个 bug。
     这里只存一个数（滚动位置），不存任何选中状态：选中态在宿主那边。 */
  function savedScroll() {
    try {
      var st = vscode && vscode.getState ? vscode.getState() : null;
      return st && typeof st.scrollTop === "number" ? st.scrollTop : 0;
    } catch (e) { return 0; }
  }
  function saveScroll() {
    try { if (vscode) vscode.setState({ scrollTop: window.scrollY }); } catch (e) { /* 存不下就算了 */ }
  }
  var restoreTop = savedScroll();
  if (restoreTop > 0) {
    window.scrollTo(0, restoreTop);
    // 第一帧可能还没排完（缩略图撑高度）—— 下一帧再对一次。**一次性校正，不是动画**。
    requestAnimationFrame(function () { window.scrollTo(0, restoreTop); });
  }
  window.addEventListener("scroll", saveScroll, { passive: true });

  var anchorId = null;   // 连选/滑选的起点（上一次点过的那块）
  var pressed = null;    // 本次按下落在哪张卡
  var dragged = false;   // 按下之后是否滑到过别的卡
  var hoveredId = null;  // 滑选时避免同一张卡反复发消息

  function cardOf(node) {
    while (node && node !== root) {
      if (node.classList && node.classList.contains("card")) return node;
      node = node.parentNode;
    }
    return null;
  }
  function idOf(card) { return card ? card.getAttribute("data-block") : null; }

  /** 按下去弹一下。同一个元素连点两次也要能重播，所以先摘掉再强制回流。 */
  function pop(card) {
    if (!card) return;
    card.classList.remove("pop");
    void card.offsetWidth;
    card.classList.add("pop");
    setTimeout(function () { card.classList.remove("pop"); }, 320);
  }

  /* ── 点选 / 滑选 ──────────────────────────────────────────── */

  root.addEventListener("mousedown", function (ev) {
    if (ev.button !== 0) return;
    if (ev.target.closest && ev.target.closest("[data-action]")) return; // 底部那排按钮不参与选块
    var card = cardOf(ev.target);
    if (!card) return;
    ev.preventDefault(); // 拖过几块时别把文字选蓝
    pressed = card;
    dragged = false;
    hoveredId = null;
    pop(card);
  });

  root.addEventListener("mouseover", function (ev) {
    if (!pressed) return;
    var card = cardOf(ev.target);
    if (!card || card === pressed) return;
    var id = idOf(card);
    if (!id || id === hoveredId) return;
    dragged = true;
    hoveredId = id;
    pop(card);
    post({ type: "blocks:range", from: anchorId || idOf(pressed), to: id });
  });

  document.addEventListener("mouseup", function (ev) {
    if (!pressed) return;
    var card = pressed;
    pressed = null;
    // 拖过 → 上面已经发过 range 了；没拖 → 这才是一次"点选"
    if (dragged) { anchorId = idOf(card); return; }
    var id = idOf(card);
    if (!id) return;
    if (ev.shiftKey && anchorId && anchorId !== id) {
      post({ type: "blocks:range", from: anchorId, to: id });
      return;
    }
    anchorId = id;
    post({ type: "blocks:toggle", blockId: id });
  });

  root.addEventListener("click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest("[data-action]") : null;
    if (!btn) return;
    var action = btn.getAttribute("data-action");
    if (action === "mode") post({ type: "blocks:mode" });
    else if (action === "clear") post({ type: "blocks:clear" });
    else if (action === "ask") post({ type: "blocks:ask" });
  });
})();
`;

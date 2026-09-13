/**
 * 侧边栏 webview 的客户端脚本，以字符串形式内联进 HTML（见 html.ts）。
 *
 * @anchor 三条纪律：
 *   1. **绝不用 `innerHTML` 装模型返回的文本** —— AI 输出是不可信输入，
 *      一律 `textContent`。侧边栏里每一个字都来自 `ExplanationResult`。
 *   2. 只用 `postMessage` 与宿主通信，具体消息形状见 `src/protocol.ts`（§5.3）。
 *      启动时先发一条 `ui:ready`：宿主收到后会把最近的消息原样重放，
 *      因此 webview 不需要自己持久化任何状态。
 *   3. 本脚本是宿主产物的字符串常量，**不参与类型检查**。改动时保持
 *      `locationLabel` 的显示规则与 `core/src/locationLabel.ts` 一致
 *      （webview 不能 import core：它不经 esbuild 打包）。
 */

export const SIDEBAR_CLIENT_SCRIPT = `
(function () {
  var vscode = acquireVsCodeApi();

  var EMPHASIS_LABEL = {
    primary: "重点",
    context: "上下文",
    definition: "定义",
    caveat: "注意"
  };

  var STATE_LABEL = {
    idle: "已结束",
    running: "讲解中",
    playing: "播放中",
    paused: "已暂停",
    done: "已讲完",
    error: "出错"
  };

  var snapshot = null;
  var trace = [];

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function locText(loc) {
    if (!loc) return "";
    if (typeof loc.lineStart === "number") {
      return loc.lineEnd > loc.lineStart
        ? "第 " + loc.lineStart + "-" + loc.lineEnd + " 行"
        : "第 " + loc.lineStart + " 行";
    }
    if (typeof loc.page === "number") return "第 " + loc.page + " 页";
    return "";
  }

  function buildHeader(result, index, state) {
    var wrap = mk("div", "header");
    if (result.title) wrap.appendChild(mk("h1", "doc-title", result.title));
    if (result.summary) wrap.appendChild(mk("p", "summary", result.summary));

    var meta = mk("div", "meta");
    meta.appendChild(mk("span", "badge", STATE_LABEL[state] || state));
    meta.appendChild(mk("span", "badge", "第 " + (index + 1) + "/" + result.steps.length + " 步"));
    var pct = Math.round((typeof result.confidence === "number" ? result.confidence : 0) * 100);
    meta.appendChild(mk("span", "badge", "可信度 " + pct + "%"));
    wrap.appendChild(meta);
    return wrap;
  }

  function buildStep(step, i, current) {
    var li = mk("li", "step" + (i === current ? " current" : i < current ? " dim" : ""));
    li.setAttribute("data-act", "goto");
    li.setAttribute("data-index", String(i));

    var head = mk("div", "step-head");
    head.appendChild(mk("span", "step-title", (i + 1) + ". " + (step.title || "步骤")));

    var loc = mk("button", "loc", locText(step.location));
    loc.setAttribute("data-act", "reveal");
    loc.setAttribute("data-index", String(i));
    loc.title = "在编辑器里定位到这一段";
    head.appendChild(loc);
    li.appendChild(head);

    if (step.intro) li.appendChild(mk("p", "intro", step.intro));
    if (step.text) li.appendChild(mk("p", "text", step.text));

    var subs = step.highlights || [];
    if (subs.length) {
      var ul = mk("ul", "highlights");
      for (var k = 0; k < subs.length; k++) {
        var h = subs[k];
        var row = mk("li");
        var emphasis = h.emphasis || "primary";
        row.appendChild(mk("span", "tag tag-" + emphasis, EMPHASIS_LABEL[emphasis] || emphasis));
        row.appendChild(mk("span", "narration", h.narration + " [" + locText(h.location) + "]"));
        ul.appendChild(row);
      }
      li.appendChild(ul);
    }

    return li;
  }

  function buildToolbar(index, total, ended) {
    var bar = mk("div", "toolbar");

    var prev = mk("button", null, "上一步");
    prev.setAttribute("data-act", "prev");
    prev.disabled = ended || index <= 0;

    var next = mk("button", null, index >= total - 1 ? "讲完了" : "下一步");
    next.setAttribute("data-act", "next");
    next.disabled = ended || index >= total - 1;

    var stop = mk("button", null, "退出");
    stop.setAttribute("data-act", "stop");
    stop.disabled = ended;

    bar.appendChild(prev);
    bar.appendChild(next);
    bar.appendChild(stop);
    return bar;
  }

  function buildTrace() {
    var box = mk("section", "trace");
    var title = mk("h2", null, "取件日志");
    box.appendChild(title);
    if (!trace.length) {
      box.appendChild(mk("div", "empty", "本次讲解没有请求额外上下文。"));
      return box;
    }
    var ul = mk("ul");
    for (var i = 0; i < trace.length; i++) {
      var e = trace[i];
      var mark = e.accepted ? "接受" : "拒绝";
      var reason = e.rejectReason ? "（" + e.rejectReason + "）" : "";
      var chars = typeof e.resultChars === "number" ? " · " + e.resultChars + " 字" : "";
      // 逐字段防御：entry 的形状由宿主保证，但这一段不能让整块日志消失
      var kind = e && e.request && e.request.type ? e.request.type : "未知请求";
      var round = typeof e.round === "number" ? e.round : "?";
      ul.appendChild(mk("li", null, "第 " + round + " 轮 " + kind + " " + mark + reason + chars));
    }
    box.appendChild(ul);
    return box;
  }

  function render() {
    var root = document.getElementById("root");
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);

    if (!snapshot) {
      root.appendChild(mk("p", "empty", "等待讲解…"));
      return;
    }

    var result = snapshot.result;
    root.appendChild(buildHeader(result, snapshot.index, snapshot.state));

    var list = mk("ul", "steps");
    for (var i = 0; i < result.steps.length; i++) {
      list.appendChild(buildStep(result.steps[i], i, snapshot.index));
    }
    root.appendChild(list);

    if (snapshot.ended) root.appendChild(mk("p", "ended", "讲解已结束。重新选中一段再发起即可。"));
    root.appendChild(buildToolbar(snapshot.index, result.steps.length, snapshot.ended));
    root.appendChild(buildTrace());
  }

  document.body.addEventListener("click", function (ev) {
    var target = ev.target;
    var hit = target && target.closest ? target.closest("[data-act]") : null;
    if (!hit) return;
    var act = hit.getAttribute("data-act");
    var index = parseInt(hit.getAttribute("data-index") || "0", 10);
    if (act === "next") vscode.postMessage({ type: "ui:next" });
    else if (act === "prev") vscode.postMessage({ type: "ui:prev" });
    else if (act === "stop") vscode.postMessage({ type: "ui:stop" });
    else if (act === "reveal") vscode.postMessage({ type: "ui:revealStep", index: index });
    else if (act === "goto") vscode.postMessage({ type: "ui:goto", index: index });
  });

  window.addEventListener("message", function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "session:update") {
      snapshot = { result: msg.result, index: msg.index, state: msg.state, ended: false };
      render();
    } else if (msg.type === "session:end") {
      if (snapshot) snapshot.ended = true;
      render();
    } else if (msg.type === "tooltrace:append") {
      trace.push(msg.entry);
      render();
    }
  });

  // ---- 键盘转发（D47）------------------------------------------------------
  // webview 里的按键**不会冒泡到工作台**，所以一旦焦点落在面板上，
  // contributes.keybindings 里那几条就全哑了。这里用宿主内联进来的用户实际绑定
  // （ANCHOR_CHORDS）自己匹配一遍，匹配上就转成协议消息。
  // 编辑器有焦点时这段永远不触发（事件根本不到这儿），所以不会与工作台键位重复派发。
  function chordParts(chord) {
    var parts = String(chord).toLowerCase().split("+");
    var has = function (m) { return parts.indexOf(m) >= 0; };
    return {
      key: parts[parts.length - 1],
      ctrl: has("ctrl") || has("control"),
      shift: has("shift"),
      alt: has("alt") || has("option"),
      meta: has("cmd") || has("meta") || has("win") || has("super")
    };
  }

  function matchesChord(ev, chord) {
    var want = chordParts(chord);
    if (!!ev.ctrlKey !== want.ctrl) return false;
    if (!!ev.shiftKey !== want.shift) return false;
    if (!!ev.altKey !== want.alt) return false;
    if (!!ev.metaKey !== want.meta) return false;

    var pressed = String(ev.key || "").toLowerCase();
    if (want.key === "escape") return pressed === "escape" || pressed === "esc";
    if (want.key === "space") return pressed === " " || pressed === "spacebar";
    return pressed === want.key;
  }

  var FORWARDED = ["next", "prev", "stop"];

  window.addEventListener("keydown", function (ev) {
    var chords = (typeof ANCHOR_CHORDS === "object" && ANCHOR_CHORDS) || {};
    for (var i = 0; i < FORWARDED.length; i++) {
      var chord = chords[FORWARDED[i]];
      if (!chord || !matchesChord(ev, chord)) continue;
      ev.preventDefault();
      vscode.postMessage({ type: "ui:" + FORWARDED[i] });
      return;
    }
  });

  vscode.postMessage({ type: "ui:ready" });
})();
`;

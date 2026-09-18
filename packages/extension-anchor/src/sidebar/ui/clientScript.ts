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
  /** 本次会话的锚点文件（session:update 带来的）。判断"这个位置要不要标文件名"用它。 */
  var anchorPath = null;

  /**
   * 路径切分：反斜杠与正斜杠**都算分隔符**，并丢掉空段。
   *
   * 这份脚本是一整个模板字符串 —— 源码里的反斜杠要写两个，才等于运行时的一个。
   * 若写成只认正斜杠的字符类，运行时其实只按正斜杠切，于是 Windows 路径（模型常写成 c: 开头）
   * 整条都切不开，把绝对路径全印进了标签（D70 实测）；再少写一个甚至直接变成语法错误，
   * 整块面板一片空白且屏幕上没有任何报错（D69 实测）。所以这里**一个反斜杠都不写**，
   * 统一走 fromCharCode(92)，并用测试钉住"两种斜杠都算分隔符"。
   */
  function pathParts(p) {
    var bs = String.fromCharCode(92);
    var raw = String(p).split(bs).join("/").split("/");
    var out = [];
    for (var i = 0; i < raw.length; i++) if (raw[i] !== "") out.push(raw[i]);
    return out;
  }

  /** 与 core 的 samePath 同一个立场：忽略大小写与斜杠方向（webview 里 import 不到 core）。 */
  function normLoc(p) {
    return pathParts(p).join("/").toLowerCase();
  }

  /** 路径末段（文件名）。 */
  function shortName(p) {
    var parts = pathParts(p);
    return parts[parts.length - 1];
  }

  /** 路径末两段（Inc/esc.h）。标签与取件日志都用它：两个同名文件正是这里会分不清（D68/D70）。 */
  function shortTail(p) {
    return pathParts(p).slice(-2).join("/");
  }

  /**
   * 位置的人话标签。**不在锚点文件里的位置必须带上文件名**（D69）——
   * 否则「[第 16 行]」看起来就是锚点文件的第 16 行，而它可能是另一个文件的
   * （用户实测就是这么被绕住的：读了的两个文件里的定义被标成了 main.c 的行号）。
   */
  function locTextWithFile(location) {
    var text = locText(location);
    var file = location && typeof location.filePath === "string" ? location.filePath : null;
    if (!file || !anchorPath || normLoc(file) === normLoc(anchorPath)) return text;
    return shortName(file) + " " + text;
  }

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /** 是不是 PDF 位置。判断方式与 core 的 isPDFLocation 一致（webview 里 import 不到 core）。 */
  function isPdfLoc(loc) {
    return !!loc && typeof loc.page === "number";
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

  function buildHeader(result, index, state, pointIndex) {
    var wrap = mk("div", "header");
    if (result.title) wrap.appendChild(mk("h1", "doc-title", result.title));
    if (result.summary) wrap.appendChild(mk("p", "summary", result.summary));

    var meta = mk("div", "meta");
    meta.appendChild(mk("span", "badge", STATE_LABEL[state] || state));
    meta.appendChild(mk("span", "badge", "第 " + (index + 1) + "/" + result.steps.length + " 步"));
    if (typeof pointIndex === "number" && pointIndex >= 0) {
      var points = (result.steps[index].highlights || []).length;
      // live：当前这一刻的位置，给它上色，其余徽章保持安静
      meta.appendChild(mk("span", "badge live", "正在扫第 " + (pointIndex + 1) + "/" + points + " 个逻辑点"));
    } else {
      meta.appendChild(mk("span", "badge live", "正在看整段"));
    }
    var pct = Math.round((typeof result.confidence === "number" ? result.confidence : 0) * 100);
    meta.appendChild(mk("span", "badge", "可信度 " + pct + "%"));
    wrap.appendChild(meta);
    return wrap;
  }

  function buildStep(step, i, current, pointIndex) {
    // 压暗交给 CSS 的 .step:not(.current)：之前和之后的步骤一视同仁，
    // 否则"还没讲到的"会和当前步一样亮，屏幕上就没有焦点可言
    var li = mk("li", "step" + (i === current ? " current" : ""));
    li.setAttribute("data-act", "goto");
    li.setAttribute("data-index", String(i));

    var head = mk("div", "step-head");
    head.appendChild(mk("span", "step-title", (i + 1) + ". " + (step.title || "步骤")));

    var loc = mk("button", "loc", locTextWithFile(step.location));
    loc.setAttribute("data-act", "reveal");
    loc.setAttribute("data-index", String(i));
    // 两条线的定位方式不同，提示词也不能一样 ——
    // 对 PDF 说"在编辑器里定位"是句假话，用户会以为是它坏了（S6）；
    // D76 起这句还要说清"会闪一下那一块"——只滚页的话，目标就在当前页时看着像没反应。
    loc.title = isPdfLoc(step.location) ? "把 PDF 滚到这一页，并闪一下那一块" : "在编辑器里定位到这一段";
    head.appendChild(loc);
    li.appendChild(head);

    if (step.intro) li.appendChild(mk("p", "intro", step.intro));
    if (step.text) li.appendChild(mk("p", "text", step.text));

    var subs = step.highlights || [];
    if (subs.length) {
      var ul = mk("ul", "highlights");
      for (var k = 0; k < subs.length; k++) {
        var h = subs[k];
        // 只有"当前这一步"才谈得上"正在扫第几个点"；其它步的行不参与高亮
        var scanning = i === current && k === pointIndex;
        var row = mk("li", scanning ? "scanning" : null);
        // 标记槽每行都占同样宽（空行也是空字符串），否则 ▸ 会把那一行整体顶右，标签列就错开了
        row.appendChild(mk("span", "mark", scanning ? "▸" : ""));
        var emphasis = h.emphasis || "primary";
        row.appendChild(mk("span", "tag tag-" + emphasis, EMPHASIS_LABEL[emphasis] || emphasis));
        row.appendChild(mk("span", "narration", h.narration + " [" + locTextWithFile(h.location) + "]"));
        if (scanning) row.id = "anchor-scanning";
        ul.appendChild(row);
      }
      li.appendChild(ul);
    }

    return li;
  }

  /**
   * 注意：这个字符串里**不能出现反引号**（它是外层模板字符串的结束符，写一个就把文件切断了）。
   * JS 代码里要引用标识符就用双引号括起来，别用反引号。
   *
   * done 的判断只能用 state === "done"，不能用 index >= total - 1：
   * 一拍 = 一个扫描点之后，最后一步的第一拍还没走完它内部的点，
   * 按步骤下标去禁用「下一步」会把剩下的点直接憋死。
   */
  /**
   * 底部三个按钮。**「讲完」之后不许变成死路**（D61 的同一条规矩，D72 落到这里）。
   *
   * （这段注释里**不许出现反引号** —— 它会把模板字符串提前截断，整个面板就白屏了。
   * 写代码时踩过三次，记在这儿。）
   * 原来 ended 会把三个按钮**全部**禁掉，而键盘那边 ESC / Alt+[ 仍然是好的 ——
   * 同一时刻、同一个人，按键盘能回看、点按钮不能，这不是"保守"，是自相矛盾
   * （用户看到的就是"面板卡死了"）。而且"讲完想回看一步"恰恰是这时候最常想做的事。
   * 现在：上一步 = 只要不在开头就能按（**结束后也允许**：回看是把讲解用完）；
   * 下一步 = 讲完/结束就禁（确实没东西可推进）；退出 = **永远能按**（与 ESC 一致，
   * 而且它是"收掉高亮"的唯一按钮出口）。
   */
  function buildToolbar(done, atStart, ended) {
    var bar = mk("div", "toolbar");

    var prev = mk("button", null, "上一步");
    prev.setAttribute("data-act", "prev");
    prev.disabled = atStart;

    var next = mk("button", null, done ? "讲完了" : "下一步");
    next.setAttribute("data-act", "next");
    next.disabled = done || ended;

    var stop = mk("button", null, "退出");
    stop.setAttribute("data-act", "stop");
    stop.disabled = false; // 明写出来（而不是"不赋值"）：这是"永远能按"的意图，测试也钉着它

    bar.appendChild(prev);
    bar.appendChild(next);
    bar.appendChild(stop);
    return bar;
  }

  /**
   * 讲完之后那两颗按钮（D83）。**与上面那段 ended 说明是一对**：说明说"还能做什么"，这里是"能做"。
   *
   * 用户的原话是「讲解结束时，需要能重新讲，并且应该能保存/重放之前的内容」。
   * 在那之前，讲完（done）之后面板上**一个出口都没有**：只能回编辑器重新选一段再按快捷键 ——
   * 而他正看着面板，手边没有"重来一次"的任何按钮（与 D61/D72「讲完不许是死路」同一条规矩）。
   *
   * 两颗按钮**刻意分开**，因为代价差一个数量级：
   *   - 重放：本地把存档再走一遍，不碰网络、不花钱，结果一模一样
   *   - 重新讲：拿同一个锚点再问一次模型，会得到另一种讲法，也会再花一次钱
   * 合成一颗的话，我们就在替用户做一个他未必想做的选择（再花一次钱）。
   *
   * 这里**不许出现反引号**（它是外层模板字符串的结束符，写一个就把文件切断了）——
   * 上面这段注释里的花名一律不加引号，就是这个原因。
   */
  function buildRerun() {
    var row = mk("div", "rerun");

    var replay = mk("button", null, "重放上次讲解");
    replay.setAttribute("data-act", "replay");
    replay.title = "不再问模型：把这份讲解从第 1 步重新走一遍，结果一模一样";
    row.appendChild(replay);

    var again = mk("button", null, "重新讲一遍");
    again.setAttribute("data-act", "reExplain");
    again.title = "用同一个锚点再问一次模型 —— 会得到另一种讲法，也会再花一次钱";
    row.appendChild(again);

    return row;
  }

  /**
   * 「读了哪个文件的哪几行」—— 用户要看的就是这一句（截图问题 3.4）。
   * 路径只取文件名：面板窄，而"哪个文件"靠文件名就够了（完整路径在输出面板「Anchor」里）。
   */
  function describeEntry(e) {
    var req = (e && e.request) || {};
    var params = req.params || {};
    var kind = req.type ? req.type : "未知请求";
    var start = typeof params.start === "number" ? params.start : "?";
    var end = typeof params.end === "number" ? params.end : "?";
    if (kind === "file" && typeof params.path === "string") {
      // 末两段（Inc/esc.h）：这里正是"两个同名文件分不清"会出问题的地方（D69）
      return shortTail(params.path) + " " + start + "-" + end + " 行";
    }
    if (kind === "page_range") return "第 " + start + "-" + end + " 页";
    return kind;
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
      var round = typeof e.round === "number" ? e.round : "?";
      ul.appendChild(mk("li", null, "第 " + round + " 轮 " + describeEntry(e) + " " + mark + reason + chars));
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
    var index = snapshot.index;
    var pointIndex = snapshot.pointIndex;
    var done = snapshot.state === "done" || snapshot.state === "idle";

    root.appendChild(buildHeader(result, index, snapshot.state, pointIndex));

    var list = mk("ul", "steps");
    for (var i = 0; i < result.steps.length; i++) {
      list.appendChild(buildStep(result.steps[i], i, index, pointIndex));
    }
    root.appendChild(list);

    // 讲完（done）与已结束（ended）都给这一块（D83）：
    // done 时「下一步」已经按不动了，若只在 ended 时给出口，"讲完了但还没按退出"这个
    // 最常见的时刻恰恰是没有出口的那一个 —— 而它正是用户说"需要能重新讲"时所处的状态。
    if (done || snapshot.ended) {
      root.appendChild(
        mk(
          "p",
          "ended",
          snapshot.ended
            ? "讲解已结束 —— 按「上一步」可以回看，按「退出」收掉高亮。想再看一遍不用重新选："
            : "已经讲完了 —— 按「上一步」可以回看。想再看一遍不用重新选：",
        ),
      );
      root.appendChild(buildRerun());
    }
    root.appendChild(buildToolbar(done, snapshot.atStart, snapshot.ended));
    root.appendChild(buildTrace());

    // render() 每次都重建整个 DOM，容器高度归零后 scrollTop 会被夹回顶部 ——
    // 不补这一下，用户每按一次"下一步"都会被弹回面板最上面，看不到正在讲的那一行。
    // block:"nearest" 只在目标不可见时才滚动，所以不会打扰正在读的人。
    var scanning = document.getElementById("anchor-scanning");
    if (scanning && typeof scanning.scrollIntoView === "function") {
      scanning.scrollIntoView({ block: "nearest" });
    }
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
    else if (act === "replay") vscode.postMessage({ type: "ui:replay" });
    else if (act === "reExplain") vscode.postMessage({ type: "ui:reExplain" });
    else if (act === "reveal") vscode.postMessage({ type: "ui:revealStep", index: index });
    else if (act === "goto") vscode.postMessage({ type: "ui:goto", index: index });
  });

  /**
   * 出错了要让**屏幕上看得见**（D70）。这一块的死法太安静：脚本一抛异常，
   * 表现是"面板不再更新、按钮没反应、屏幕上什么错都不显示"（异常发生在 webview 里，
   * 扩展的日志与输出通道都收不到）—— 用户只能看到"卡死"。
   * 兜住它，并把第一行错因写进面板：一句话就能定位，比 DevTools 快。
   */
  function showClientError(err) {
    var root = document.getElementById("root");
    if (!root) return;
    var text = err && err.message ? err.message : String(err);
    var box = mk("div", "client-error", "面板脚本出错：" + text);
    root.insertBefore(box, root.firstChild);
  }

  window.addEventListener("message", function (ev) {
    try {
      handleMessage(ev);
    } catch (err) {
      showClientError(err);
    }
  });

  function handleMessage(ev) {
    var msg = ev.data;
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "session:update") {
      // atStart 由"第 0 步的整块那一拍"推出，不必再让宿主多传一个字段
      var atStart = msg.index === 0 && !(msg.pointIndex >= 0);
      snapshot = {
        result: msg.result,
        index: msg.index,
        state: msg.state,
        pointIndex: typeof msg.pointIndex === "number" ? msg.pointIndex : -1,
        atStart: atStart,
        ended: false
      };
      // 锚点文件（D69）：标签要不要带文件名，全看它。旧宿主不发这个字段时退化成 null
      // （那就与从前一样，一律不标 —— 不标是"少说"，标错才是"说反"）
      anchorPath = typeof msg.anchorPath === "string" ? msg.anchorPath : null;
      render();
    } else if (msg.type === "session:end") {
      if (snapshot) snapshot.ended = true;
      render();
    } else if (msg.type === "tooltrace:reset") {
      // 新一轮讲解开始：清空上一轮的记录（这个数组活得比一轮讲解长，见协议里的说明）
      trace = [];
      render();
    } else if (msg.type === "tooltrace:append") {
      trace.push(msg.entry);
      render();
    }
  }

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
    // 按住不放会以每秒几十次的速度重复触发：每一次都是一条 ui:next + 一次换拍 + 一次"打开文件"，
    // 那不是"快速推进"，是把面板与编辑器一起压住（松开之后才慢慢缓过来）。自动重复一律忽略。
    if (ev.repeat) return;
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

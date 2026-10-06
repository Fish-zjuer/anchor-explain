/**
 * 开始面板的客户端脚本。**字符串常量**，内联进 webview（与侧边栏同一个做法，见 D42/约束 19）。
 *
 * @anchor 这份脚本里**没有一条业务判断**，这是刻意的，也是这个切片想证明的事：
 *         - 显示什么、能不能点、灰掉时说什么 —— 全在 `start/startModel.ts` 里算好了
 *         - 这里只做三件事：把模型画成 DOM、把点击换成 `start:run` 消息、启动时喊一声 ready
 *         - 唯一带脑子的地方是"点击落在按钮里的文字上时往上找 `data-action`"，
 *           那属于 DOM 事件处理，不属于产品逻辑
 *
 * **两条硬约束**（违反的后果都不是编译错误，而是运行期一片空白）：
 *   1. **不能出现反引号** —— 它会被当成外层模板字符串的结束符（约束 27）
 *   2. **不能出现 `${`** —— 同理，那是模板插值
 *
 * 文案一律走 `textContent`，不拼 HTML 字符串：模型里有用户自己的配置文本（baseUrl、
 * 文件路径），拼进去就等于让"设置里写了什么"决定面板的 DOM。
 */

export const START_CLIENT_SCRIPT = `
(function () {
  var vscode = acquireVsCodeApi();
  var root = document.getElementById('root');

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  // @anchor: S15-fix1 图标配短名称；完整名称、键位、说明仍来自模型的悬停提示和读屏。
  var actionLabels = {
    capture: '讲解选区', configure: '模型端点', setApiKey: 'API Key', showState: '自检', openSettings: '设置',
    addSegment: '加一段', explainSegments: '讲队列', clearSegments: '清空队列',
    openPdf: '打开 PDF', selectRegion: '框选区域',
    replayLast: '重放', showHistory: '历史', reExplain: '重新讲解', goto: '跳到某步',
    loadHandoff: '生成', reopenHandoff: '重开', copy: '复制',
  };
  var iconPaths = {
    capture: 'M7 7L2 12l5 5M17 7l5 5-5 5M14 4l-4 16',
    addSegment: 'M4 4h12v16H4zM7 8h6M7 12h4M19 8v8M16 12h6',
    explainSegments: 'M3 4h11M3 8h11M3 12h7M3 16h7M15 11l7 5-7 5z',
    clearSegments: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    configure: 'M7 3v5M17 3v5M5 8h14v3a7 7 0 01-14 0zM12 18v4',
    openSettings: 'M10 2h4l1 4 4-1 2 4-3 3 3 3-2 4-4-1-1 4h-4l-1-4-4 1-2-4 3-3-3-3 2-4 4 1zM15 12a3 3 0 11-6 0 3 3 0 016 0',
    setApiKey: 'M14 8a5 5 0 11-10 0 5 5 0 0110 0zM12 12l9 9M17 17l3-3M19 19l3-3',
    showState: 'M3 3h18v18H3zM5 13h4l2-5 3 9 2-4h3',
    openPdf: 'M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8M8 19h5',
    selectRegion: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8z',
    replayLast: 'M8 5l-6 6 6 6M3 11h11a6 6 0 010 12M13 5l8 5-8 5z',
    showHistory: 'M3 3v5h5M3 8a9 9 0 119 13M12 7v5l4 2',
    reExplain: 'M3 9a9 9 0 0116-5l2 3M21 2v5h-5M21 15a9 9 0 01-16 5l-2-3M3 22v-5h5',
    loadHandoff: 'M5 2h9l5 5v5M14 2v6h5M5 2v20h7M13 17h9M18 13l4 4-4 4',
    reopenHandoff: 'M5 2h9l5 5v5M14 2v6h5M5 2v20h7M22 17h-9M17 13l-4 4 4 4',
    goto: 'M3 12h15M12 6l6 6-6 6M21 3v18',
    copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
    info: 'M12 3a9 9 0 110 18 9 9 0 010-18M12 11v6M12 7v1',
  };

  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconPaths[name] || iconPaths.info);
    svg.appendChild(path);
    return svg;
  }

  function iconButton(name, description, className) {
    var button = el('button', 'icon-button' + (className ? ' ' + className : ''));
    button.setAttribute('type', 'button');
    button.setAttribute('title', description);
    button.setAttribute('aria-label', description);
    button.appendChild(icon(name));
    button.appendChild(el('span', 'button-label', actionLabels[name] || ''));
    return button;
  }

  function renderAction(action) {
    var description = action.title;
    if (action.chord) description += '\\n快捷键：' + action.chord;
    if (action.note) description += '\\n' + action.note;
    if (!action.enabled) description += '\\n当前不可用';
    var button = iconButton(action.id, description, 'action' + (action.enabled ? '' : ' off'));
    // 用 aria-disabled 保留键盘焦点：不可用原因也能被读屏获知；点击委托守卫阻止执行。
    button.setAttribute('aria-disabled', String(!action.enabled));
    button.setAttribute('data-action', action.id);
    return button;
  }

  /**
   * D130：位置交接那一格的**输入框**（用户要的"投币机"）。
   *
   * 三条实情决定了它长这样：
   *   1. 必须是 textarea 而不是 input —— 位置清单是**多行**的
   *   2. **草稿由 model 带回来**（model.handoffDraft）：render() 每次都把 root 清空，
   *      不从这里回填，用户粘进去的字每重画一次就没一次
   *   3. 拖拽要在**这里**拦：dragover 必须 preventDefault，否则浏览器不认这次 drop
   *      （这是 HTML5 拖放的规矩，不是我们的选择）
   */
  function handoffInput(model, classic) {
    var area = el('textarea', 'handoff-input');
    area.setAttribute('data-handoff', 'draft');
    area.setAttribute('rows', classic ? '4' : '3');
    area.setAttribute('spellcheck', 'false');
    var inputHint = '粘贴外部 Agent 给的位置，或将位置清单文件拖进来。\\n每行一段：{"filePath":"src/main.c","lineStart":120,"lineEnd":168}';
    area.setAttribute('title', inputHint);
    area.setAttribute('aria-label', inputHint);
    // 回填草稿（**放在 value 而不是 textContent** —— textarea 的初值走 value）
    area.value = typeof model.handoffDraft === 'string' ? model.handoffDraft : '';
    if (classic) area.placeholder = '{"filePath":"src/main.c","lineStart":120,"lineEnd":168}';
    return area;
  }

  function renderHandoffBox(model, section) {
    var box = renderSection(section, 'handoff');
    box.appendChild(handoffInput(model, false));

    var tools = el('div', 'handoff-tools');
    for (var i = 0; i < section.actions.length; i += 1) tools.appendChild(renderAction(section.actions[i]));
    // D132：复制提示词。走宿主写剪贴板（理由见 protocol.ts 里 start:copyPrompt 那段）。
    var copy = iconButton('copy', '复制给外部 Agent 的提示词\\n' + (model.handoffPrompt || ''), 'handoff-copy');
    copy.setAttribute('data-copy-prompt', '1');
    tools.appendChild(copy);
    box.appendChild(tools);
    return box;
  }

  function renderSection(section, extraClass) {
    var box = el('section', 'section' + (extraClass ? ' ' + extraClass : ''));
    box.setAttribute('aria-label', section.title);
    return box;
  }

  // @anchor: 经典卡片复用同一份动作/状态和消息委托，布局切换不派发业务命令。
  function classicRun(action, label) {
    var button = el('button', 'classic-run', label || (action.enabled ? '执行' : '不可用'));
    button.setAttribute('type', 'button');
    button.setAttribute('data-action', action.id);
    button.disabled = !action.enabled;
    return button;
  }

  function classicAction(action) {
    var box = el('div', 'classic-action' + (action.enabled ? '' : ' off'));
    var head = el('div', 'row-head');
    head.appendChild(el('span', 'title', action.title));
    if (action.chord) head.appendChild(el('span', 'chord', action.chord));
    box.appendChild(head);
    box.appendChild(el('div', 'note', action.note));
    box.appendChild(classicRun(action));
    return box;
  }

  function classicHandoff(model, action) {
    var box = el('div', 'classic-handoff');
    box.appendChild(el('div', 'handoff-label', '把外部 Agent 给的位置粘在这里（也可以把那个文件拖进来）'));
    box.appendChild(handoffInput(model, true));
    box.appendChild(el('div', 'handoff-hint', '外部 Agent 那边可以照着这句要求它输出：'));
    box.appendChild(el('code', 'handoff-prompt', model.handoffPrompt));
    var copy = el('button', 'classic-copy', '复制这句');
    copy.setAttribute('type', 'button');
    copy.setAttribute('data-copy-prompt', '1');
    box.appendChild(copy);
    var row = el('div', 'handoff-row');
    row.appendChild(classicRun(action, '生成临时文件'));
    box.appendChild(row);
    return box;
  }

  function classicSection(title) {
    var box = el('section', 'classic-section');
    box.appendChild(el('h2', null, title));
    return box;
  }

  function renderClassic(model) {
    var head = el('div', 'head');
    head.appendChild(el('div', 'brand', 'Anchor'));
    head.appendChild(el('div', 'sub', model.openChord
      ? '讲解选中的代码或框选一块 PDF，随时按 ' + model.openChord + ' 回到这里'
      : '讲解选中的代码或框选一块 PDF；命令面板里搜「Anchor」也能回到这里'));
    root.appendChild(head);
    for (var i = 0; i < model.sections.length; i += 1) {
      var section = model.sections[i];
      var box = classicSection(section.title);
      for (var j = 0; j < section.actions.length; j += 1) {
        var action = section.actions[j];
        box.appendChild(action.id === 'loadHandoff' ? classicHandoff(model, action) : classicAction(action));
      }
      root.appendChild(box);
    }
    var status = classicSection('现在');
    for (var k = 0; k < model.status.length; k += 1) {
      var item = model.status[k];
      var line = el('div', 'status-line ' + item.tone);
      line.appendChild(el('span', 'label', item.label));
      line.appendChild(el('span', 'value', item.value));
      status.appendChild(line);
    }
    root.appendChild(status);
  }

  function render(model) {
    root.textContent = '';
    var layout = model.layout === 'classic' || model.layout === 'compact' ? model.layout : 'adaptive';
    root.className = 'layout-' + layout;
    document.body.setAttribute('data-start-layout', layout);

    // 字号缩放（D89）：与讲解面板同一个系数、同一条 CSS 变量。每次收到模型都应用 ——
    // 系数变化靠宿主推新模型，不需要单独的消息类型。
    // documentElement 那层守卫：这份脚本也会被塞进最小 DOM 桩里解析（startUi.test.ts）。
    if (typeof model.fontScale === 'number' && isFinite(model.fontScale) && model.fontScale > 0) {
      var de = document.documentElement;
      if (de && de.style && typeof de.style.setProperty === 'function') {
        de.style.setProperty('--anchor-font-scale', String(model.fontScale));
      }
    }

    root.setAttribute('aria-label', model.openChord ? 'Anchor 开始界面（' + model.openChord + '）' : 'Anchor 开始界面');
    if (layout === 'classic') {
      renderClassic(model);
      return;
    }

    var paired = null;
    for (var i = 0; i < model.sections.length; i += 1) {
      var section = model.sections[i];
      if (section.id === 'handoff') {
        root.appendChild(renderHandoffBox(model, section));
        continue;
      }
      var box = renderSection(section, section.id);
      for (var j = 0; j < section.actions.length; j += 1) {
        box.appendChild(renderAction(section.actions[j]));
      }
      if (layout === 'adaptive' && (section.id === 'segments' || section.id === 'line2')) {
        if (!paired) {
          paired = el('div', 'paired-sections');
          root.appendChild(paired);
        }
        paired.appendChild(box);
      } else {
        root.appendChild(box);
      }
    }

    var status = renderSection({ title: '现在' }, 'status wide');
    var statusIcons = ['configure', 'openPdf', 'capture', 'addSegment', 'reopenHandoff', 'showState'];
    var statusLabels = ['模型', 'PDF', '捕获', '队列', '临时文件', '讲解'];
    for (var k = 0; k < model.status.length; k += 1) {
      var item = model.status[k];
      var indicator = el('span', 'status-icon ' + item.tone);
      indicator.setAttribute('tabindex', '0');
      indicator.setAttribute('role', 'img');
      indicator.setAttribute('title', item.label + '：' + item.value);
      indicator.setAttribute('aria-label', item.label + '：' + item.value);
      indicator.appendChild(icon(statusIcons[k]));
      indicator.appendChild(el('span', 'status-label', statusLabels[k] || item.label));
      status.appendChild(indicator);
    }
    root.appendChild(status);
  }

  // 事件委托：面板是重画的，逐个绑监听器会在每次刷新时漏掉一批
  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node !== document.body) {
      // D132：复制提示词。**在 data-action 之前判** —— 那颗按钮不带 data-action
      // （它不是"动作 id"，而是一条具体请求），顺序反了就会掉进下面那条分支、
      // 被当成一个查不到的动作 id 静默丢掉。
      if (node.getAttribute && node.getAttribute('data-copy-prompt') === '1') {
        vscode.postMessage({ type: 'start:copyPrompt' });
        return;
      }
      if (node.getAttribute && node.getAttribute('data-action') && !node.disabled && node.getAttribute('aria-disabled') !== 'true') {
        var actionId = node.getAttribute('data-action');
        // D130：「生成临时文件」走**另一条消息** —— 它要带上输入框里的内容。
        // 其余动作仍然只回传 id（§5.5 那条约定照旧管着它们）。
        if (actionId === 'loadHandoff') {
          var box = document.querySelector('[data-handoff="draft"]');
          vscode.postMessage({ type: 'start:handoff', text: box && box.value ? box.value : '' });
          return;
        }
        vscode.postMessage({ type: 'start:run', id: actionId });
        return;
      }
      node = node.parentNode;
    }
  });

  /**
   * D130：把文件**拖进输入框**。
   *
   * 两件事必须做对，否则拖上去毫无反应：
   *   1. dragover 要 preventDefault() —— HTML5 拖放的规矩，不拦就没有 drop
   *   2. 读文件用 File.text()，而**拿不到路径**（浏览器/webview 的安全约定）——
   *      所以拖进来的只有**内容**，这与"点选文件"（宿主侧 showOpenDialog，有路径）
   *      不是冗余，而是两种场合。
   */
  document.addEventListener('dragover', function (event) {
    if (!event.target || !event.target.getAttribute) return;
    if (event.target.getAttribute('data-handoff') !== 'draft') return;
    event.preventDefault();
  });

  document.addEventListener('drop', function (event) {
    var node = event.target;
    if (!node || !node.getAttribute || node.getAttribute('data-handoff') !== 'draft') return;
    event.preventDefault();
    var files = event.dataTransfer ? event.dataTransfer.files : null;
    if (!files || files.length === 0) return;
    var file = files[0];
    // 主动拦大小：几百 KB 塞进 DOM 会把面板卡死，不如当场说清楚
    if (file.size > 256 * 1024) {
      node.value = '';
      node.placeholder = '这个文件太大了（' + Math.round(file.size / 1024) + 'KB）—— 位置清单一般只有几行';
      return;
    }
    file.text().then(function (text) {
      node.value = text;
      vscode.postMessage({ type: 'start:handoffDraft', text: text });
      node.placeholder = '已从 ' + file.name + ' 读入 —— 再点下面的「生成临时文件」';
    }).catch(function () {
      node.placeholder = '读不了这个文件，请用「从文件读入位置清单」重试';
    });
  });

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (message && message.type === 'start:model') render(message.model);
  });

  /**
   * D130：输入框里打字/粘贴时把草稿**立刻告诉宿主**（走同一条 start:handoff 消息，
   * 但宿主那一侧只在"点了生成"时才真的去解析）。
   *
   * @anchor 为什么打一个字就发一条：面板**随时会被重画**（会话换拍、状态变化都会刷新），
   *         而重画是 root.textContent = '' —— 那一刻 DOM 里的字就没了。
   *         宿主手里必须**始终**有一份最新的草稿，重画时才能原样填回来。
   *         与侧边栏 askDrafts 那条（D126）是同一个套路，只是多跨了一道 webview 边界。
   *
   *         不担心"打一个字发一条消息会累"：这是一次字符串拷贝，用户打字的速度下毫无压力；
   *         而丢掉草稿是**用户已经明确抱怨过**的那类问题（"给了很多的提示词，没了"）。
   */
  document.addEventListener('input', function (event) {
    var node = event.target;
    if (!node || !node.getAttribute || node.getAttribute('data-handoff') !== 'draft') return;
    vscode.postMessage({ type: 'start:handoffDraft', text: node.value == null ? '' : String(node.value) });
  });

  // 握手：宿主收到 ready 才发第一份模型（面板可能比宿主晚很多才被打开）
  vscode.postMessage({ type: 'start:ready' });
})();
`;

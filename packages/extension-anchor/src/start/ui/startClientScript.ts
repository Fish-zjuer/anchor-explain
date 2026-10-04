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

  function renderAction(action) {
    var box = el('div', 'action' + (action.enabled ? '' : ' off'));

    var head = el('div', 'row-head');
    head.appendChild(el('span', 'title', action.title));
    if (action.chord) head.appendChild(el('span', 'chord', action.chord));
    box.appendChild(head);

    box.appendChild(el('div', 'note', action.note));

    var button = el('button', 'run', action.enabled ? '执行' : '不可用');
    button.disabled = !action.enabled;
    button.setAttribute('data-action', action.id);
    box.appendChild(button);

    return box;
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
  function renderHandoffBox(model, action) {
    var box = el('div', 'handoff');

    var label = el('div', 'handoff-label', '把外部 Agent 给的位置粘在这里（也可以把那个文件拖进来）');
    box.appendChild(label);

    var area = el('textarea', 'handoff-input');
    area.setAttribute('data-handoff', 'draft');
    area.setAttribute('rows', '4');
    area.setAttribute('spellcheck', 'false');
    area.placeholder =
      '{"filePath": "src/main.c", "lineStart": 120, "lineEnd": 168}\\n{"filePath": "include/util.h", "lineStart": 3, "lineEnd": 40}';
    // 回填草稿（**放在 value 而不是 textContent** —— textarea 的初值走 value）
    area.value = typeof model.handoffDraft === 'string' ? model.handoffDraft : '';
    box.appendChild(area);

    var hint = el('div', 'handoff-hint', '外部 Agent 那边可以照着这句要求它输出：');
    box.appendChild(hint);
    var code = el('code', 'handoff-prompt', model.handoffPrompt);
    box.appendChild(code);

    // D132：复制提示词。走宿主写剪贴板（理由见 protocol.ts 里 start:copyPrompt 那段）。
    var copy = el('button', 'handoff-copy', '复制这句');
    copy.setAttribute('data-copy-prompt', '1');
    copy.setAttribute('type', 'button');
    box.appendChild(copy);

    var row = el('div', 'handoff-row');
    var run = el('button', 'run', '生成临时文件');
    run.setAttribute('data-action', action.id);
    run.disabled = !action.enabled;
    row.appendChild(run);
    box.appendChild(row);

    return box;
  }

  function renderSection(section, extraClass) {
    var box = el('section', 'section' + (extraClass ? ' ' + extraClass : ''));
    box.appendChild(el('h2', null, section.title));
    return box;
  }

  function render(model) {
    root.textContent = '';

    // 字号缩放（D89）：与讲解面板同一个系数、同一条 CSS 变量。每次收到模型都应用 ——
    // 系数变化靠宿主推新模型，不需要单独的消息类型。
    // documentElement 那层守卫：这份脚本也会被塞进最小 DOM 桩里解析（startUi.test.ts）。
    if (typeof model.fontScale === 'number' && isFinite(model.fontScale) && model.fontScale > 0) {
      var de = document.documentElement;
      if (de && de.style && typeof de.style.setProperty === 'function') {
        de.style.setProperty('--anchor-font-scale', String(model.fontScale));
      }
    }

    var head = el('div', 'head');
    head.appendChild(el('div', 'brand', 'Anchor'));
    head.appendChild(
      el(
        'div',
        'sub',
        model.openChord
          ? '讲解选中的代码或框选一块 PDF，随时按 ' + model.openChord + ' 回到这里'
          : '讲解选中的代码或框选一块 PDF；命令面板里搜「Anchor」也能回到这里',
      ),
    );
    root.appendChild(head);

    for (var i = 0; i < model.sections.length; i += 1) {
      var section = model.sections[i];
      var box = renderSection(section);
      for (var j = 0; j < section.actions.length; j += 1) {
        var action = section.actions[j];
        // D130：位置交接那一组里，「生成临时文件」那颗按钮**不长成普通按钮** ——
        // 它跟一个输入框是一体的（投币机）。其余动作照旧。
        if (action.id === 'loadHandoff') {
          box.appendChild(renderHandoffBox(model, action));
        } else {
          box.appendChild(renderAction(action));
        }
      }
      root.appendChild(box);
    }

    var status = renderSection({ title: '现在' }, 'status');
    for (var k = 0; k < model.status.length; k += 1) {
      var item = model.status[k];
      var line = el('div', 'status-line ' + item.tone);
      line.appendChild(el('span', 'label', item.label));
      line.appendChild(el('span', 'value', item.value));
      status.appendChild(line);
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
      if (node.getAttribute && node.getAttribute('data-action') && !node.disabled) {
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
      node.placeholder = '已从 ' + file.name + ' 读入 —— 再点下面的「生成临时文件」';
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

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

  function renderSection(section, extraClass) {
    var box = el('section', 'section' + (extraClass ? ' ' + extraClass : ''));
    box.appendChild(el('h2', null, section.title));
    return box;
  }

  function render(model) {
    root.textContent = '';

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
        box.appendChild(renderAction(section.actions[j]));
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
      if (node.getAttribute && node.getAttribute('data-action') && !node.disabled) {
        vscode.postMessage({ type: 'start:run', id: node.getAttribute('data-action') });
        return;
      }
      node = node.parentNode;
    }
  });

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (message && message.type === 'start:model') render(message.model);
  });

  // 握手：宿主收到 ready 才发第一份模型（面板可能比宿主晚很多才被打开）
  vscode.postMessage({ type: 'start:ready' });
})();
`;

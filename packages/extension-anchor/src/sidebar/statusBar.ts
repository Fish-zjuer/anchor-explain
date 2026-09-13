/**
 * 状态栏提示。事实源：docs/CONTRACTS.md §5.4 —— 提示里的键位**必须来自用户实际绑定**，
 * 读不到才回退默认文案（D10）。
 *
 * @anchor 这个文件承担两件事，别把它当成"只是一行文字"：
 *   1. 讲解期间它是唯一的常驻可见入口（点一下打开跳转面板）；
 *   2. 它是 staleness 唯一如实告诉用户的地方 —— 侧边栏协议（§5.3）里没有这个字段，
 *      而"文件已被改动、高亮可能错行"这种话必须有人讲。
 */

import * as vscode from 'vscode';
import type { WalkthroughSnapshot } from '../playback/WalkthroughSession.ts';
import type { WalkthroughState } from '../protocol.ts';
import {
  defaultChords,
  formatChord,
  keybindingsPathFrom,
  parseKeybindings,
  resolveChords,
} from './keybindingResolve.ts';
import type { ResolvedChord, ResolvedChords } from './keybindingResolve.ts';

export interface StatusBarHandle {
  /** 请求已发出、讲解还没回来时的中转文案（S3 里这一刻可能是几秒的网络往返） */
  showBusy(label: string): void;
  update(snapshot: WalkthroughSnapshot): void;
  hide(): void;
  dispose(): void;
  /**
   * 已解析的键位（读不到就是默认）。宿主把它内联进侧边栏 HTML ——
   * **webview 里的按键不会冒泡到工作台**，不给它一份键位表，面板有焦点时所有键都是哑的。
   */
  chords(): ResolvedChords;
  /**
   * 自检用：这个状态栏项此刻到底是什么状态。
   * 用户报过"找不到状态栏提示"，而"看不见"可能是没显示、也可能是被别人挤掉了 ——
   * 只有把 `shown` 与 `text` 读出来才能分辨（`Anchor: 显示状态` 会打印它）。
   */
  probe(): { shown: boolean; text: string };
}

const STATE_ICON: Record<WalkthroughState, string> = {
  idle: '$(circle-slash)',
  running: '$(book)',
  playing: '$(play)',
  paused: '$(debug-pause)',
  done: '$(check)',
  error: '$(error)',
};

const STATE_WORD: Record<WalkthroughState, string> = {
  idle: '已结束',
  running: '讲解中',
  playing: '播放中',
  paused: '已暂停',
  done: '已讲完',
  error: '出错',
};

/** 解绑时**只去掉键、不去掉动作**（§5.4）：用户仍该知道"退出"这件事存在。 */
function withKey(chord: ResolvedChord, action: string): string {
  return chord === null ? action : `${formatChord(chord)} ${action}`;
}

export function createStatusBar(context: vscode.ExtensionContext): StatusBarHandle {
  const isMac = process.platform === 'darwin';
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'anchorExplain.goto';

  let chords: ResolvedChords = defaultChords(isMac);
  // `StatusBarItem` 没有"我现在显示着吗"这个属性（真实 API 里没有），自己记一份
  let visible = false;

  // 建好就去读一次用户的 keybindings.json（一个很小的文件，且只读这一次）。
  // 为什么不等"第一次要显示"再读：侧边栏 HTML 里要内联同一份键位，
  // 晚读会让第一帧提示与面板派发的键不一致（先默认、再跳变）。读不到就静默保留默认（D10）。
  void readUserChords(context.globalStorageUri.fsPath, isMac)
    .then((resolved) => {
      if (resolved) chords = resolved;
    })
    .catch(() => {
      // 静默回退：状态栏文案宁可保守，也不能因为读不到键位就让讲解失败
    });

  /** 「第 2/3 步 · 第 1/2 点」—— 一拍一个扫描点，得让用户知道扫到哪儿了（D48）。 */
  function progressText(snapshot: WalkthroughSnapshot): string {
    const head = `${snapshot.index + 1}/${snapshot.total} 步`;
    return snapshot.pointIndex >= 0 ? `${head} · 第 ${snapshot.pointIndex + 1}/${snapshot.pointTotal} 点` : head;
  }

  function hint(snapshot: WalkthroughSnapshot): string {
    const bits: string[] = [`${STATE_ICON[snapshot.state]} ${progressText(snapshot)}`, STATE_WORD[snapshot.state]];

    // done / idle 之后 next / prev 的 context key 已落 false，键位已不生效 ——
    // 再挂在提示里就是让用户看两个按不动的键（`stop` 用的是另一个 key，所以它一直有效）。
    if (snapshot.state !== 'done' && snapshot.state !== 'idle') {
      bits.push(withKey(chords.next, '下一步'));
      bits.push(withKey(chords.prev, '上一步'));
    }
    bits.push(withKey(chords.stop, '退出'));

    return bits.filter((b) => b !== '').join(' · ');
  }

  return {
    showBusy(label) {
      item.text = `$(sync~spin) ${label}`;
      item.tooltip = '正在请求讲解…';
      item.show();
      visible = true;
    },

    update(snapshot) {
      const stale = snapshot.stale ? '$(warning) 文件已改动 · ' : '';
      item.text = `${stale}${hint(snapshot)}`;
      item.tooltip = new vscode.MarkdownString(
        [
          `**Anchor 讲解**：第 ${snapshot.index + 1}/${snapshot.total} 步`,
          snapshot.pointIndex >= 0
            ? `正在讲第 ${snapshot.pointIndex + 1}/${snapshot.pointTotal} 个逻辑点`
            : '先看整段的范围，再逐点展开',
          '',
          snapshot.step.title ?? '',
          '',
          snapshot.stale ? '⚠️ 讲解开始后文件被改动过，高亮位置可能已不准。' : '',
          '点击此提示可跳到指定步。',
        ].join('\n'),
      );
      item.show();
      visible = true;
    },

    hide() {
      item.hide();
      visible = false;
    },

    dispose() {
      item.dispose();
      visible = false;
    },

    chords() {
      return { ...chords };
    },

    probe() {
      return { shown: visible, text: item.text };
    },
  };
}

/** 读用户绑定。文件不存在 / JSONC 坏掉 / 路径推导失败 → 返回 null 让调用方留默认。 */
async function readUserChords(
  globalStorageFsPath: string,
  isMac: boolean,
): Promise<ResolvedChords | null> {
  const target = keybindingsPathFrom(globalStorageFsPath);
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target));
  const entries = parseKeybindings(new TextDecoder('utf-8').decode(bytes));
  if (entries.length === 0) return null;
  return resolveChords(entries, isMac);
}

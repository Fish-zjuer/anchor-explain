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
import { STATE_WORD } from '../protocol.ts';
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

// 状态词不在这里：它挪到了 `protocol.ts`（贴着 `WalkthroughState` 放），
// 因为开始面板要说同一句话 —— 两处各写一张表，改一处就会分家。上面的图标表
// 只有状态栏用，所以留在原地。

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

/**
 * 多段队列的常驻指示（D81）。
 *
 * @anchor 用户报的原话：「加入队列，虽然下面的按钮有反应，但是没有文本什么的提示，感觉不妥，
 *         要么持续性图形显示加入了多少，要么每加一次给一个成功提示。」
 *
 *         这条反馈的要点不是"缺一句提示"，而是**提示出现在了他没看的地方**：
 *         面板上那颗按钮在屏幕上方，而队列那一行状态在面板**最下面**（要滚动才看得到）；
 *         临时状态栏消息 3 秒就没了，正在找"加入的到底进没进去"的人多半已经错过。
 *
 *         所以这里给一个**一直挂着**的计数：只要队列不空就在视野里，点一下还能打开面板
 *         （讲全部段 / 移除某一段 / 清空都在那儿）。与讲解那个状态栏项分开成两项而不是拼在一起：
 *         它们的**生命周期不同** —— 讲解结束那一项要收掉，队列不空就得一直显示。
 */
export interface QueueStatusBarHandle {
  update(queue: QueueView): void;
  dispose(): void;
  /** 自检用（与 `StatusBarHandle.probe` 同一条理由：分辨"没显示"与"被挤掉"） */
  probe(): { shown: boolean; text: string };
}

export interface QueueView {
  readonly count: number;
  /** 队列里每一段的一行描述（与移除用的 QuickPick 同一份数据） */
  readonly lines: readonly { readonly label: string; readonly description: string }[];
  /** 这一句是给 tooltip 用的总结；空队列不显示这一项，可以传 null */
  readonly summary: string | null;
}

export function createQueueStatusBar(): QueueStatusBarHandle {
  // 优先级比讲解那一项（100）低一格 —— 讲解期间"讲到哪儿了"更该靠左、更该抢眼。
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  // 点它去**开始面板**，而不是直接弹一个选择框：用户此刻想知道的是"队列里到底有什么"，
  // 面板上有那一行（还有三颗按钮）；而"移除"只是其中一条路，不该被当成唯一入口。
  item.command = 'anchorExplain.showStart';
  let visible = false;

  return {
    update(queue) {
      if (queue.count <= 0) {
        item.hide();
        visible = false;
        return;
      }

      item.text = `$(list-ordered) 队列 ${queue.count} 段`;
      item.tooltip = new vscode.MarkdownString(
        [
          `**Anchor 多段队列**：${queue.summary ?? `${queue.count} 段`}`,
          '',
          ...queue.lines.map((line) => `- ${line.label}${line.description ? ` — ${line.description}` : ''}`),
          '',
          '讲的时候这几段会**合成一份**讲解。点击此提示打开开始面板，可以讲全部段 / 移除某一段 / 清空。',
        ].join('\n'),
      );
      item.show();
      visible = true;
    },

    dispose() {
      item.dispose();
      visible = false;
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

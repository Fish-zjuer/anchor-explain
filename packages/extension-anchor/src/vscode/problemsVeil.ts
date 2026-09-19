/**
 * 讲解期间的「报错遮罩」—— 把 VS Code 官方的错误/警告/提示藏起来，讲解完精确还原。
 * 事实源：docs/CONTRACTS.md §4.1（`stop` / 会话生命周期）。
 *
 * @anchor 用户的需求原话是"讲解时只出现我们的高亮，讲解完不影响其余高亮，不是破坏性排除"。
 *
 *         为什么是**切设置开关**而不是"画一层盖上去"：squiggle 画在背景 decoration **之上**
 *         （先背景、后文本、后诊断线），任何不透明底色都盖不住它；而我们又拿不到
 *         别的扩展/语言服务创建的诊断集合（`DiagnosticCollection` 是各家私有的）。
 *         所以唯一可靠的官方机制是 `problems.visibility`（VS Code 1.87 起）：
 *         关掉它，错误/警告/提示在编辑器、小地图、概览标尺里全部消失；打开就回来。
 *
 *         **非破坏性**由三条规矩保证（判据在 `problemsVeilRule.ts`，可直测）：
 *           1. 只在"现在看得见"的时候动手 —— 用户本来就关了 problems 的，我们什么都不写、
 *              也就什么都不用还原；
 *           2. 记录的是**我们的写法之前的全局值**（可能为 `undefined` = 本来就没设），
 *              还原时把它原样写回去（`undefined` = 删掉我们那个键）；
 *           3. 还原前核对"我们写下的 false 还在原位" —— 用户讲解中途自己改了这个设置的话，
 *              保留他的值，我们的记录直接作废。
 *
 *         崩溃恢复：遮罩记录存在 `workspaceState` 里，hide 写入、restore 清除。
 *         万一 VS Code 在讲解中直接被杀（restore 没跑到），下一次 activate 的 `recover()`
 *         会看到残留记录并立即还原 —— 不留一个"永远没有波浪线"的窗口。
 *
 *         已知边界：`problems.visibility` 是**窗口级全局**，讲解期间同一台机器上
 *         其他 VS Code 窗口的波浪线也会一起消失。这是该设置的粒度，接受它。
 *
 * 本文件的判定逻辑（`restoreAction` 等）在 `src/problemsVeilRule.ts` —— 那个文件
 * 不 import 'vscode'，`node --test` 直测；本文件只做设置读写这一层薄壳。
 */

import * as vscode from 'vscode';
import { PROBLEMS_VEIL_KEY, restoreAction } from '../problemsVeilRule.ts';
import type { VeilRecord } from '../problemsVeilRule.ts';

export { PROBLEMS_VEIL_KEY, restoreAction };
export type { VeilRecord };

export interface ProblemsVeil {
  /** 讲解开始：藏起全部官方提示。失败只上报，绝不打断讲解。 */
  hide(): Promise<void>;
  /** 讲解结束：精确还原。没遮过就是空操作。 */
  restore(): Promise<void>;
  /** 上一次会话可能没走到 restore（崩溃 / 直接关窗口）：activate 时调一次。 */
  recover(): Promise<void>;
}

export function createProblemsVeil(memento: vscode.Memento, onError?: (message: string) => void): ProblemsVeil {
  const problems = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('problems');

  const report = (what: string, err: unknown): void => {
    onError?.(`${what}失败（${err instanceof Error ? err.message : String(err)}）—— 官方提示的显示状态不会被改变`);
  };

  async function hide(): Promise<void> {
    try {
      const cfg = problems();
      // 用户本来就藏着：什么都不写、什么都不记 —— 我们没有制造任何需要还原的东西
      if (cfg.get<boolean>('visibility', true) === false) return;
      const record: VeilRecord = { original: cfg.inspect<boolean>('visibility')?.globalValue };
      // 先记后写：两步之间被杀，最多是"留着一条待还原的记录"（recover 会处理），
      // 不会反过来变成"改了设置却没人记得原值"
      await memento.update(PROBLEMS_VEIL_KEY, record);
      await cfg.update('visibility', false, vscode.ConfigurationTarget.Global);
    } catch (err) {
      // settings.json 有语法错误时 `update` 会抛（D63 踩过）——讲解照常进行，只是没遮住
      report('隐藏官方提示', err);
    }
  }

  async function restore(): Promise<void> {
    try {
      const record = memento.get<VeilRecord>(PROBLEMS_VEIL_KEY);
      const currentGlobal = problems().inspect<boolean>('visibility')?.globalValue;
      const action = restoreAction(record, currentGlobal);
      if (action === 'noop') {
        // 记录还在但不需要还原（用户中途自己接管了）：把记录清掉，别让它把 recover 骗来再还一次
        if (record) await memento.update(PROBLEMS_VEIL_KEY, undefined);
        return;
      }
      await problems().update('visibility', action.write, vscode.ConfigurationTarget.Global);
      await memento.update(PROBLEMS_VEIL_KEY, undefined);
    } catch (err) {
      report('还原官方提示', err);
    }
  }

  return {
    hide,
    restore,
    recover: restore,
  };
}

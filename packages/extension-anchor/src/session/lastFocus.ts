/**
 * 「上一次那句额外提示词」的存与读（D121）。纯逻辑，宿主侧的 `workspaceState` 由调用方给。
 *
 * @anchor 用户的原话："用户的上一次额外的提示词应该可以保存，因为可能误操作、
 *         对上一次回答不满意，但可能给了很多的提示词，没了，再写又烦又不能完全一样。"
 *
 *         所以下一次问这句话时，**输入框会预填上一次的内容**：
 *         直接回车就是用它的原话，全选删掉就是不用它。
 *
 *         ⚠ **他建议的是"全空时按方向向上键自动填充"，那条做不到**：VS Code 的
 *         `showInputBox` 是工作台自己的控件，扩展**拿不到它的按键事件**（没有这个 API），
 *         而注册一个全局的"上箭头"键位会把编辑器里的光标移动一起吃掉。
 *         能做到的是控制输入框的**初值** —— 那正好是更省事的等价物：不用按任何键，
 *         内容已经在那儿了。
 *
 *         存的位置：`workspaceState`（**按工作区隔离**，且不进 settings.json）。
 *         它是用户的输入，不是配置；写进 settings 会跟着设置同步到处跑。
 */

/** 存档键名。与 `session/lastRun.ts` 的 `LAST_RUN_KEY` 同一个约定。 */
export const LAST_FOCUS_KEY = 'anchorExplain.lastFocus';

/** 存进去的形状：非空字符串；别的一律当"没存过"。 */
export function coerceStoredFocus(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

/** 读上一次那句（没有就 `undefined`）。 */
export function readLastFocus(store: { get<T>(key: string): T | undefined }): string | undefined {
  return coerceStoredFocus(store.get<unknown>(LAST_FOCUS_KEY));
}

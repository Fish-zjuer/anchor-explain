/**
 * 报错遮罩的**纯判定**（D89）。与 `vscode/problemsVeil.ts` 是一对 ——
 * 那边是 `vscode` 设置读写的薄壳（import 'vscode'，进不了 `node --test`），
 * 这边是"什么情况下该还原、什么情况下必须收手"的判据，可直测。
 *
 * 为什么这条判据值得单独一个文件：**"非破坏性"的承诺全部落在它身上** ——
 * 看到不该动的状态还伸手，就是把"临时藏一下"做成"永久改了用户的设置"。
 */

/** `workspaceState` 里的记录键。**不要改**：改了等于让崩溃恢复失忆。 */
export const PROBLEMS_VEIL_KEY = 'anchorExplain.problemsVeil';

/** 遮罩期间记在 `workspaceState` 里的东西：我们动手之前的**全局值**。 */
export interface VeilRecord {
  readonly original: boolean | undefined;
}

/**
 * 还原时该做什么（`restore()` 与 `recover()` 共用）。
 *
 * - 没有记录 → 没遮过（或已还原过）：什么都不写。**尤其不要**看到 false 就替用户打开 ——
 *   那个 false 可能就是用户自己设的。
 * - 有记录、但全局值已不是我们写下的 `false` → 用户中途改过：保留用户的值，记录作废。
 * - 有记录、全局值还是 `false` → 原样写回记录值（`undefined` = 删掉我们的键）。
 */
export function restoreAction(
  record: VeilRecord | undefined,
  currentGlobal: boolean | undefined,
): 'noop' | { write: boolean | undefined } {
  if (!record) return 'noop';
  if (currentGlobal !== false) return 'noop';
  return { write: record.original };
}

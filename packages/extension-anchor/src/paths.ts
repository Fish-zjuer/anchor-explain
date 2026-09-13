/**
 * 路径归一与比较。**不 import 'vscode'**，可在 node --test 下直测。
 *
 * @anchor 为什么值得单独一个文件：`"同一个文件"`这个判断在四处出现
 *         （校验闸门、播放器找编辑器、端口找文档、staleness 比对），
 *         每处各写一遍，早晚会有一处写成严格比较 —— 而 Windows 上那会把同一个文件判成两个，
 *         表现为"高亮跑到另一个标签页去了"，且只在大小写不一致时才复现。
 */

/** 统一斜杠方向、去掉末尾斜杠、统一大小写。用于"是不是同一个文件"的判断，不用于展示。 */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normPath(a) === normPath(b);
}

/**
 * 文本行数 = 编辑器里能看到的行数。
 *
 * 末尾换行不算作一行（`"a\n"` 是 1 行，不是 2 行），否则最后一行会平白多出一个空行，
 * 让"行号上界检查"把恰好落在文件末尾的 step 判成越界。空串算 0 行。
 */
export function countTextLines(text: string): number {
  if (text === '') return 0;
  const parts = text.split(/\r?\n/);
  return parts[parts.length - 1] === '' ? parts.length - 1 : parts.length;
}

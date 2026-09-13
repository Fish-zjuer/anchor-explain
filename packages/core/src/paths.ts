/**
 * 路径与文本行数。**两条线共用**，所以放在 core。
 *
 * @anchor 为什么值得一个独立模块：`"同一个文件"`这个判断出现在**六处**
 *         （校验闸门、播放器找编辑器、端口找文档、staleness 比对、取件闸门、线2 的定位目标匹配），
 *         每处各写一遍，早晚会有一处写成严格比较 —— 而 Windows 上那会把同一个文件判成两个，
 *         表现为"高亮跑到另一个标签页去了"，且只在大小写不一致时才复现。
 *
 * 原本这些住在 `extension-anchor/src/paths.ts`。S5 起线2 也要用（比较 fsPath、取显示名），
 * 所以搬上来 —— 与其复制一份，不如让两条线共用同一个立场。
 */

/** 统一斜杠方向、去掉末尾斜杠、统一大小写。用于"是不是同一个文件"的判断，不用于展示。 */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normPath(a) === normPath(b);
}

/**
 * 取文件名（带扩展名）。用于 `Anchor.sourceName` 这个**显示名**。
 *
 * 为什么不用 `node:path.basename`：它按运行平台决定分隔符 —— 在 Linux 上
 * `basename('C:\\repo\\main.c')` 返回整串，于是同一份锚点在两个平台上显示名不同。
 * 这里两种斜杠都当分隔符切，与 `normPath` 同一个立场：路径的写法不该改变语义。
 */
export function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/).filter((s) => s !== '');
  return parts[parts.length - 1] ?? p;
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

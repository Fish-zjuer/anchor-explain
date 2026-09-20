/**
 * 块的稳定身份（D99）。
 *
 * @anchor 为什么单独一个文件：**解答要附着在块上**，而"附着"的全部承诺都压在
 *         块 ID 的稳定性上 —— 用户今天问了第 23 页的一段，下周重开这份文档
 *         （甚至重拆一次块），那条问答还必须回到同一块上。
 *         所以 ID 不能用"处理时的序号"（插入一个图块就全错位），要用**内容本身**：
 *         首个 part 的页码 + 归一化 bbox（三位小数 —— 抽取抖动的容忍带）+ 文字开头
 *         的指纹。同一份 PDF 拆两次，这三样不变，ID 就不变。
 *
 * 本文件零依赖。
 *
 * @anchor **D100 起这里的角色变了**：`blockId` 从"块的最终身份"降级为**内容指纹**，
 *         给 `registry.ts` 当别名用（迁移升级前的存档）。真正的身份是注册表里
 *         **冻结**下来的 ID —— 因为内容会陆续被补出来（OCR 回填、缝合、手修），
 *         而身份不能跟着内容变，否则问答会静默失去落点。见 registry.ts 的文件头。
 */

/** FNV-1a 32 位：小、快、无依赖，够"同一内容同一哈希"用（不承担防碰撞安全职责） */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** 归一化坐标转成三位小数的稳定字符串（0.30000000004 与 0.3 必须是同一个 ID） */
export function coord(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/**
 * 块 ID 的原料是**确定性的**：`docId | 首个 part 的页码与 bbox | 文字长度 | 文字开头 24 个字符`。
 * 带上**长度**是手修教出来的：merge 之后块的"开头 24 字"与第一块完全一致、首 part 也一致，
 * 只看这两样，合并块的 ID 会撞上它的原料之一 —— 旧 ID 就被冒用了。
 * 手修（合并/拆开）会改变块的内容，指纹随之改变 —— 这在 D100 之后**不再影响块的最终身份**：
 * 指纹只是注册表的一个别名，`resolveIds` 会把它们归到同一个冻结 ID 上。
 */
export function blockId(docId: string | undefined, parts: readonly { page: number; bbox: readonly number[] }[], text: string): string {
  const first = parts[0];
  const head = first
    ? `${first.page}:${first.bbox.map(coord).join(',')}`
    : 'nopart';
  const tail = fnv1a(`${text.length}\u0000${text.slice(0, 24)}`);
  return docId === undefined ? `b-${head}-${tail}` : `${docId}-b-${head}-${tail}`;
}

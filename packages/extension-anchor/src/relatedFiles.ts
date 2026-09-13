/**
 * 「工作区里哪些文件可能相关」——**纯逻辑**（S9a）。宿主侧的取文件在 `vscode/relatedFiles.ts`。
 *
 * @anchor 跨文件讲解里，模型最大的障碍不是"不许读"，而是**不知道该问哪个文件**。
 *         所以我们要在 user prompt 里给它一份清单 —— 但清单不能是"工作区全部文件"
 *         （几千条既废 token 又淹没重点）。排序规则来自嵌入式的实际形状：
 *           1. 锚点正文里 **`#include` 提到过的**排最前 —— 那是**代码自己声明的依赖**，
 *              比"它恰好在同一个目录里"这个猜测更强（哪怕被 include 的文件在别的目录）
 *           2. 然后是**同一个目录**的（`main.c` 旁边的 `ring_buffer.h` 是最常见的相关者）
 *           3. 其余按路径排，总量封顶
 */

/** 清单上限。够覆盖一个模块的周边，又不至于把 prompt 撑大。 */
export const MAX_CANDIDATES = 40;

/**
 * 从锚点正文里挑出 `#include` 的目标名。
 *
 * `#include "ring_buffer.h"` → `ring_buffer.h`；`#include <stdint.h>` → `stdint.h`
 * （系统头在候选里匹配不上就被忽略）。注释里的 include 也算 ——
 * 宁可多一条匹配，也不要漏掉真正的那条。
 */
export function includeNamesIn(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/gu)) {
    const name = match[1]?.trim();
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * 排序 + 截断。输入是**已经算好的显示路径**：同目录给裸文件名（`ring_buffer.h`），
 * 其余给工作区相对路径（`Drivers/hal_gpio.h`）—— 清单里就按这个形式写，
 * 模型也照这个形式回抄给取件工具（解析规则见 `resolveCandidatePaths`）。
 */
export function orderRelatedFiles(
  display: readonly string[],
  includeNames: readonly string[] = [],
): string[] {
  const isSameDir = (candidate: string): boolean => !candidate.includes('/');
  const isIncluded = (candidate: string): boolean =>
    includeNames.some(
      (name) => name === candidate || name.endsWith(`/${candidate}`) || candidate.endsWith(`/${name}`),
    );

  const score = (candidate: string): number => {
    if (isIncluded(candidate)) return isSameDir(candidate) ? 0 : 1;
    return isSameDir(candidate) ? 2 : 3;
  };

  return [...new Set(display)].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, MAX_CANDIDATES);
}

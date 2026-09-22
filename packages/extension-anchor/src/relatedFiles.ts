/**
 * 「这次能读哪些文件」——**纯逻辑**（S9a 起；S9a-fix10 改成"清单即范围 + 假名"）。
 * 宿主侧的取文件在 `vscode/relatedFiles.ts`。
 *
 * @anchor 跨文件讲解里，模型最大的障碍不是"不许读"，而是**不知道该问哪个文件**。
 *         所以我们要在 user prompt 里给它一份清单 —— 但清单不能是"工作区全部文件"
 *         （几千条既废 token 又淹没重点）。排序规则来自嵌入式的实际形状：
 *           1. 锚点正文里 **`#include` 提到过的**排最前 —— 那是**代码自己声明的依赖**，
 *              比"它恰好在同一个目录里"这个猜测更强（哪怕被 include 的文件在别的目录）
 *           2. 然后是**同一个目录**的（`main.c` 旁边的 `ring_buffer.h` 是最常见的相关者）
 *           3. 其余按路径排，总量封顶
 *
 * @anchor **S9a-fix10 的两条改动，都是被实测逼出来的**：用户拿自己的 CubeMX 工程跑，
 *         6 次取件只成 1 次，另外 5 次 `ENOENT`——而它想要的那几个文件**清单里全都写着**。
 *
 *         ① **清单必须等于可取范围，一条不差。** 原来清单一律按"工作区里所有代码文件"建，
 *            与本次档位无关 —— 于是清单里会出现本次根本取不到的文件（档位是 `same-dir`
 *            却列着别的目录），也会漏掉本可取的文件。模型拿着"清单里明明有、取件却被拒"的
 *            清单，只会反复试。现在清单的**过滤判据与闸门同一份**（`roots` + 黑名单）：
 *            清单里的每一条都必能取到，清单外的每一条都不必试。
 *
 *         ② **清单给假名，不给路径。** 提示词与拒绝文案原来都举 `../Inc/dshot_dma.h`，
 *            而模型写出来的正是 `../Inc/transport.h`、`../Inc/esc.h` —— **照着那个例子
 *            把文件名换掉了**（它想要的头文件其实在 `../../Driver/transport/Inc/`）。
 *            举一个"看起来像标准答案"的例子，等于发一个可以套用的模板。
 *            改成 `f1`、`f2` 之后：能写的东西与清单**一一对应**，猜不出别的形状；
 *            顺带把真实路径留在了我们这边（远端模型只看见假名与用途标签）。
 */

import { dirnameOf, isInsidePath, relativePathFrom, relativeToPath, samePath } from '@anchor/core';
import { isDeniedPath } from './fetchDeny.ts';

/** 清单上限的默认值。实际用的数是设置 `anchorExplain.maxCandidateFiles`。 */
export const MAX_CANDIDATES = 40;

/** 假名前缀。`f12` 这种形状**不可能**是一个真实路径，模型也不会把它跟路径混起来。 */
const ALIAS_PREFIX = 'f';

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
 * 排序 + 截断。输入是**已经算好的标签**：同目录给裸文件名（`ring_buffer.h`），
 * 其余给相对某个基准的写法（`../Inc/dshot_dma.h`、`sub/x.h`）——
 * 标签只是给人/模型认的，**模型该写的是假名**（见 `CandidateFile.alias`）。
 */
export function orderRelatedFiles(
  display: readonly string[],
  includeNames: readonly string[] = [],
  limit: number = MAX_CANDIDATES,
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

  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : MAX_CANDIDATES;
  return [...new Set(display)].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, cap);
}

/**
 * 清单里那一条**该写成什么**（D117）：同目录 = 裸文件名；锚点目录里更深处 = 下去的相对写法；
 * 其余 = 相对锚点目录的 `..` 写法（表达不出时原样给绝对路径）。
 *
 * @anchor S9a-fix10 起它退居**兜底**：清单的主标签是"相对工作区根"（唯一、可读），
 *         只在锚点不在工作区里时落到这里。保留它是因为那两种情况都要能唯一指认，
 *         而它这三条写法都**按锚点文件所在目录**算，与闸门解析相对路径的基准一致。
 */
export function candidateDisplayName(anchorDir: string, path: string): string {
  if (isInsidePath(anchorDir, path)) return relativeToPath(anchorDir, path);
  return relativePathFrom(anchorDir, path);
}

/**
 * 清单里的一条。**`path` 不出现在 prompt 里** —— 模型只看见 `alias` 与 `label`。
 */
export interface CandidateFile {
  /** 模型写进 `path` 的假名（`f1`、`f2`…，与清单顺序一致，1-based）。 */
  alias: string;
  /** 真身（绝对路径）。假名与它的对应关系只在我们这边。 */
  path: string;
  /** 清单里给人/模型认的标签：优先"相对工作区根"（唯一），锚点不在工作区里时退化成锚点相对写法。 */
  label: string;
}

export interface CandidateInput {
  /** 扫到的候选池（绝对路径）。宿主侧一次扫描的结果 */
  files: readonly string[];
  anchorFile: string;
  /** 算标签的基准。空串 = 没有工作区，退化成锚点相对写法 */
  workspaceRoot: string;
  /**
   * 本次档位允许的根（**与闸门同一份**，见 `relatedRoots` / `fetchPolicyFor`）。
   * 清单按它过滤 —— 这是"清单即范围"的落点。空数组 = 不许读别的文件（清单为空）。
   */
  roots: readonly string[];
  includeNames: readonly string[];
  limit: number;
}

/**
 * 建清单：**过滤（同闸门）→ 排序 → 封顶 → 编假名**。
 *
 * 过滤这一步刻意与 `validateContextRequest` 用同一份 `roots` 与同一个 `isDeniedPath`：
 * 两处只要有一处不同，"清单里能点、取件却被拒"就会复现 —— 那正是用户实测里
 * 白烧 5 轮的直接原因。
 */
export function buildCandidateFiles(input: CandidateInput): CandidateFile[] {
  const { files, anchorFile, workspaceRoot, roots, includeNames, limit } = input;
  const anchorDir = dirnameOf(anchorFile);

  const pool: { label: string; path: string }[] = [];
  for (const path of files) {
    if (roots.length === 0) break; // 档位不许读别的文件：清单就是空的（`off` 档）
    if (samePath(path, anchorFile)) continue; // 锚点文件自己不用取件
    if (!roots.some((root) => isInsidePath(root, path))) continue; // ← 与闸门同一判据
    if (isDeniedPath(path)) continue; // ← 与闸门同一黑名单
    const label =
      workspaceRoot !== '' && isInsidePath(workspaceRoot, path)
        ? relativeToPath(workspaceRoot, path)
        : candidateDisplayName(anchorDir, path);
    pool.push({ label, path });
  }

  const byLabel = new Map(pool.map((p) => [p.label, p.path]));
  const kept = orderRelatedFiles(
    pool.map((p) => p.label),
    includeNames,
    limit,
  );

  return kept.map((label, i) => ({
    alias: `${ALIAS_PREFIX}${i + 1}`,
    path: byLabel.get(label)!,
    label,
  }));
}

/** 大小写与斜杠都无关的比较（清单里的标签与模型抄回来的字符串要用同一套立场）。 */
function loosePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '').toLowerCase();
}

/**
 * 模型写的 `path` → 清单里那一条。**清单驱动的档位只有这一条路**（S9a-fix10）。
 *
 * 认三种写法，都**必须**落在清单里：
 *   1. 假名本身（`f3`）—— 这是该用的写法；
 *   2. 标签**原样照抄**（`App/Inc/esc.h`）—— 抄对了也认，不让"抄错一个字符"变成一次白烧；
 *   3. 标签的**路径后缀**（`transport/Inc/transport.h`）—— 模型爱写尾巴，唯一命中就认。
 *
 * 后缀匹配要求**唯一**：命中两条以上时返回 `ambiguous`，由调用方回一句"清单里有多条 …
 * 请用假名"——那种情况一定是模型截得太短，把选择权还给它，比我们替它挑一个安全。
 */
export function findCandidate(
  candidates: readonly CandidateFile[],
  written: string,
): { entry: CandidateFile } | { ambiguous: CandidateFile[] } | undefined {
  const raw = written.trim();
  if (raw === '') return undefined;

  const alias = /^f0*(\d+)$/iu.exec(raw.replace(/\\/g, '/'));
  if (alias) {
    const index = Number(alias[1]);
    const entry = candidates[index - 1];
    return entry !== undefined && entry.alias === `${ALIAS_PREFIX}${index}` ? { entry } : undefined;
  }

  const want = loosePath(raw);
  const exact = candidates.filter((c) => loosePath(c.label) === want);
  if (exact.length === 1) return { entry: exact[0]! };

  const tail = candidates.filter((c) => loosePath(c.label).endsWith(`/${want}`));
  if (tail.length === 1) return { entry: tail[0]! };
  if (tail.length > 1) return { ambiguous: tail };
  return undefined;
}

/** 清单渲染成 prompt 里那几行。写假名是正路；照抄标签也认得（见 `findCandidate`）。 */
export function describeCandidates(candidates: readonly CandidateFile[]): string[] {
  return candidates.map((c) => `- \`${c.alias}\`  ${c.label}`);
}

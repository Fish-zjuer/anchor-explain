/**
 * 「这次能读哪些文件」——**纯逻辑**（S9a 起；S9a-fix10 改成"清单即范围"；S9a-fix12 去掉假名）。
 * 宿主侧的取文件在 `vscode/relatedFiles.ts`。
 *
 * @anchor 跨文件讲解里，模型最大的障碍不是"不许读"，而是**不知道该问哪个文件**。
 *         所以要在 user prompt 里给它一份清单 —— 但清单不能是"工作区全部文件"
 *         （几千条既废 token 又淹没重点）。排序规则来自嵌入式的实际形状：
 *           1. 锚点正文里 **`#include` 提到过的**排最前 —— 那是**代码自己声明的依赖**，
 *              比"它恰好在同一个目录里"这个猜测更强（哪怕被 include 的文件在别的目录）
 *           2. 然后是**同一个目录**的（`main.c` 旁边的 `ring_buffer.h` 是最常见的相关者）
 *           3. 其余按路径排，总量封顶
 *
 * @anchor **S9a-fix10（D119）：清单就是可取范围。** 用户拿自己的 CubeMX 工程实测：
 *         6 次取件只成 1 次，另外 5 次 `ENOENT`，**而它想要的那几个文件清单里全都写着**——
 *         它在套 CubeMX 惯例（先试 `../Inc/` 再试 `../Src/`），不是在抄清单。
 *         根因是"清单"与"能取的集合"**本来是两套东西**：清单是提示、闸门按根判，
 *         交集之外的写法都能过闸门，模型自然一直猜。现在合成一件事：
 *         `ContextFetchPolicy.candidates` 与 prompt 里那份清单是**同一个数组**，
 *         过滤判据（`roots` + 黑名单）与闸门**同一份**。
 *
 * @anchor **S9a-fix12（D124）：去掉假名，只给名字。** 用户看公告时一句反问把这一条推翻了：
 *         "文件名也是有信息的，你改成 f1、f2 什么的是多此一举" —— 对，而且更糟的是
 *         **我原来的头号理由是错的**：假名本来是为了"真实路径不进 prompt"，
 *         可 `describeAnchor` 早就把锚点的**绝对路径与所在目录**写进去了，一点都没保住。
 *         剩下的唯一好处是"假名不能被改写"（`f5` 不是路径，没法被转换成 `../Inc/f5`），
 *         而 D117 那次"模型改写路径"的压力有一半是提示词自己给的（既教它"按锚点目录算"、
 *         又给一个同形状的例子）。真正修好那个 bug 的是**"清单里的才算数"这条校验**，
 *         不是假名。所以现在：清单只列名字，提示词只说"照抄这一行"。
 *
 *         代价（用户已知情）：模型自己改写名字的概率可能回升。但那种失败现在很便宜 ——
 *         拒绝文案明说"照抄清单里那一行"，属自纠路径，而且被拒还有宽限轮数（D123）。
 */

import { dirnameOf, isInsidePath, relativePathFrom, relativeToPath, samePath } from '@anchor/core';
import { isDeniedPath } from './fetchDeny.ts';

/** 清单上限的默认值。实际用的数是设置 `anchorExplain.maxCandidateFiles`。 */
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
 * 排序 + 截断。输入是**已经算好的标签**：同目录给裸文件名（`ring_buffer.h`），
 * 其余给相对某个基准的写法（`App/Inc/esc.h`）。**标签就是模型要照抄的那串东西**。
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
 * 清单里那一条**该写成什么**：同目录 = 裸文件名；锚点目录里更深处 = 下去的相对写法；
 * 其余 = 相对锚点目录的 `..` 写法（表达不出时原样给绝对路径）。
 *
 * @anchor 它只在"锚点不在工作区里"时用得上（那时标签退化成这个基准）。
 *         三条写法都**按锚点文件所在目录**算，与闸门解析相对路径的基准一致。
 */
export function candidateDisplayName(anchorDir: string, path: string): string {
  if (isInsidePath(anchorDir, path)) return relativeToPath(anchorDir, path);
  return relativePathFrom(anchorDir, path);
}

/**
 * 清单里的一条。`label` 就是 prompt 里那一行，**模型照抄它**。
 *
 * @anchor 没有 `alias` 字段了（D124）。曾经有过，名义是"真实路径不进 prompt"——
 *         可锚点的绝对路径本来就在 prompt 里（`describeAnchor`），那条理由不成立。
 */
export interface CandidateFile {
  /** 真身（绝对路径）。 */
  path: string;
  /** 清单里那一行的名字（优先"相对工作区根"，锚点不在工作区里时退化成锚点相对写法）。 */
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
 * 建清单：**过滤（同闸门）→ 排序 → 封顶**。
 *
 * 过滤这一步刻意与 `validateContextRequest` 用同一份 `roots` 与同一个 `isDeniedPath`：
 * 两处只要有一处不同，"清单里能点、取件却被拒"就会复现 —— 那正是用户实测里
 * 白烧 5 轮的直接原因。
 */
export function buildCandidateFiles(input: CandidateInput): CandidateFile[] {
  const { files, anchorFile, workspaceRoot, roots, includeNames, limit } = input;
  const anchorDir = dirnameOf(anchorFile);

  const pool: CandidateFile[] = [];
  for (const path of files) {
    if (roots.length === 0) break; // 档位不许读别的文件：清单就是空的（`off` 档）
    if (samePath(path, anchorFile)) continue; // 锚点文件自己不用取件
    if (!roots.some((root) => isInsidePath(root, path))) continue; // ← 与闸门同一判据
    if (isDeniedPath(path)) continue; // ← 与闸门同一黑名单
    const label =
      workspaceRoot !== '' && isInsidePath(workspaceRoot, path)
        ? relativeToPath(workspaceRoot, path)
        : candidateDisplayName(anchorDir, path);
    pool.push({ path, label });
  }

  const byLabel = new Map(pool.map((p) => [p.label, p.path]));
  const kept = orderRelatedFiles(
    pool.map((p) => p.label),
    includeNames,
    limit,
  );

  return kept.map((label) => ({ path: byLabel.get(label)!, label }));
}

/** 大小写与斜杠都无关的比较（清单里的标签与模型抄回来的字符串要用同一套立场）。 */
function loosePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '').toLowerCase();
}

/**
 * 模型写的 `path` → 清单里那一条（D124：**只认名字**，没有假名了）。
 *
 * 两种写法，都**必须**落在清单里：
 *   1. 标签**原样照抄**（`App/Inc/esc.h`）—— 这是正路；
 *   2. 标签的**路径后缀**（`Inc/esc.h` 之于 `Driver/esc/Inc/esc.h`）—— 模型爱写尾巴，
 *      唯一命中就认，不让"写短了"变成一次白烧。
 *
 * 后缀命中两条以上时返回 `ambiguous`，由调用方回一句"清单里有多条以 … 结尾，请照抄完整那一行"——
 * 那种情况一定是模型截得太短，把选择权还给它，比我们替它挑一个安全。
 */
export function findCandidate(
  candidates: readonly CandidateFile[],
  written: string,
): { entry: CandidateFile } | { ambiguous: CandidateFile[] } | undefined {
  const raw = written.trim();
  if (raw === '') return undefined;

  const want = loosePath(raw);
  const exact = candidates.filter((c) => loosePath(c.label) === want);
  if (exact.length === 1) return { entry: exact[0]! };

  const tail = candidates.filter((c) => loosePath(c.label).endsWith(`/${want}`));
  if (tail.length === 1) return { entry: tail[0]! };
  if (tail.length > 1) return { ambiguous: tail };
  return undefined;
}

/** 清单渲染成 prompt 里那几行。**每一行就是模型该照抄的那个名字**。 */
export function describeCandidates(candidates: readonly CandidateFile[]): string[] {
  return candidates.map((c) => `- ${c.label}`);
}

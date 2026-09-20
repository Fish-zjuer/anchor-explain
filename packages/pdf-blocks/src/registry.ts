/**
 * 块身份的冻结层（D100）：**ID 分配一次，之后只增不减；被并掉的不删除，只退休**。
 *
 * @anchor 为什么必须有这一层：答案、注释、手修全都挂在块 ID 上（"块本身就是定位"），
 *         而块的内容是**陆续补出来的** —— OCR 回填会改文字、跨页缝合会并块、
 *         用户手修会拆合、引擎升级会改缝合决策。只要 ID 还由内容算出来，
 *         这四件事每一件都会把旧 ID 换掉，用户已经问过的那条问答就**静默**失去落点
 *         （D99 那版实现里四个都已经具备了）。
 *
 *         所以 ID 与内容分家：身份存在这份**纯数据**的注册表里（落盘是调用方的事），
 *         内容怎么变都不用动它。旧 ID（含引擎的内容指纹形态）一律进 `aliases` ——
 *         **退休的 ID 不消失，只改嫁**，按老 ID 问过的问答照样捞得回来。
 *
 * ## 匹配优先级（顺序是刻意的）
 *
 *   1. **近邻精确**：parts 与某个有效项几乎相同（容差 0.002）→ 复用它的 ID。
 *      容差不是可选项：重拆一次块时抽取会抖动，严格相等会把每一块都判成新块。
 *   2. **长大了**（缝合）：本块的 parts **包含**某些有效项的 parts → 复用最靠前
 *      那一个的 ID（用户最可能已经问过它），其余被吞并的项**退进 `retired`**
 *      （ID + 自己的别名一并改嫁）。
 *   3. **拆开了**（取消缝合）：本块的 parts 被某个项包含 → 先在 `retired` 里找
 *      **几何对得上的那一项并把它认回来**（所以碎片拿回的是它自己的历史 ID，
 *      而不是新 ID），认不回来才铸新 ID。
 *   4. 都不沾 → 铸新 ID。
 *
 * ## 另一条：每次登记都把传入的 `block.id` 记成别名
 *
 * 那是引擎的**内容指纹**形态。这一条负责迁移 —— 升级前按指纹存档的问答，
 * 升级后照样按得上。
 *
 * 本文件零依赖，node --test 直测。
 */

import { coord } from './ids.ts';
import type { Block, BlockPart } from './types.ts';

/** parts 视为"同一块"的坐标容差（归一化）。抽取抖动实测 < 0.0005，留 4 倍余量 */
export const PART_EPS = 0.002;

export function partKeyOf(part: BlockPart): string {
  return `${part.page}:${part.bbox.map(coord).join(',')}`;
}

/** parts 的规范键（排序后再拼）：同一组 parts 无论给进来是什么顺序都是同一个键 */
export function partsKeyOf(parts: readonly BlockPart[]): string {
  return parts.map(partKeyOf).sort().join('|');
}

function partNearlyEqual(a: BlockPart, b: BlockPart, eps: number): boolean {
  return a.page === b.page && a.bbox.every((v, i) => Math.abs(v - (b.bbox[i] ?? Infinity)) <= eps);
}

/** `sub` 的每个 part 都能在 `sup` 里找到未被占用的近邻 */
export function isSubset(sub: readonly BlockPart[], sup: readonly BlockPart[], eps: number = PART_EPS): boolean {
  const used = new Array<boolean>(sup.length).fill(false);
  for (const p of sub) {
    const at = sup.findIndex((q, i) => !used[i] && partNearlyEqual(p, q!, eps));
    if (at < 0) return false;
    used[at] = true;
  }
  return true;
}

/** 两个 part 集合是否"几乎相同"（无序，贪心一一配对） */
export function partsNearlyEqual(
  a: readonly BlockPart[],
  b: readonly BlockPart[],
  eps: number = PART_EPS,
): boolean {
  if (a.length !== b.length) return false;
  return isSubset(a, b, eps) && isSubset(b, a, eps);
}

function copyParts(parts: readonly BlockPart[]): BlockPart[] {
  return parts.map((p) => ({ page: p.page, bbox: [...p.bbox] as [number, number, number, number] }));
}

function copyEntry(entry: RegistryEntry): RegistryEntry {
  return { id: entry.id, partsKey: entry.partsKey, parts: copyParts(entry.parts), aliases: [...entry.aliases] };
}

/** 一个块的身份（`parts` 是**首次登记时**的几何 —— 它随缝合长大的事由包含关系去认，不改这里） */
export interface RegistryEntry {
  id: string;
  partsKey: string;
  parts: BlockPart[];
  /** 退休的 ID：历史指纹、被吞并的邻居 —— 按它们查都能查到 `id` */
  aliases: string[];
}

/**
 * 一份文档的块身份档案。`retired` 是"被并掉的块"的墓园 ——
 * **留着它才能让取消缝合把原块认回来**（碎片拿回自己的历史 ID，而不是变成新块）。
 */
export interface BlockRegistry {
  version: 1;
  docId?: string;
  nextSeq: number;
  entries: RegistryEntry[];
  retired: RegistryEntry[];
}

export function emptyRegistry(docId?: string): BlockRegistry {
  return {
    version: 1,
    ...(docId !== undefined ? { docId } : {}),
    nextSeq: 1,
    entries: [],
    retired: [],
  };
}

function firstPartOf(parts: readonly BlockPart[]): BlockPart | undefined {
  return [...parts].sort((a, b) => a.page - b.page || a.bbox[1] - b.bbox[1])[0];
}

/**
 * 把历史 ID 解析成**当前**的块 ID。查不到就原样返回 —— **绝不抛**：
 * 它可能是命令的第一跳，一个对不上的 ID 不该让整条链路炸掉（与 D83 的存档纪律同类）。
 */
export function resolveAlias(registry: BlockRegistry, id: string): string {
  if (registry.entries.some((e) => e.id === id)) return id;
  const host = registry.entries.find((e) => e.aliases.includes(id));
  return host?.id ?? id;
}

/** 这个 ID 是不是我们发过（当前有效或已退休）—— 清理孤儿问答之前先问一句 */
export function isKnownId(registry: BlockRegistry, id: string): boolean {
  return (
    registry.entries.some((e) => e.id === id || e.aliases.includes(id)) ||
    registry.retired.some((e) => e.id === id || e.aliases.includes(id))
  );
}

/** 某个块 ID 名下的全部历史 ID（含它自己）—— 迁移问答时把旧键一起搬过去用 */
export function aliasesOf(registry: BlockRegistry, id: string): readonly string[] {
  const current = resolveAlias(registry, id);
  const entry = registry.entries.find((e) => e.id === current);
  return entry === undefined ? [id] : [entry.id, ...entry.aliases];
}

export interface ResolveResult {
  registry: BlockRegistry;
  /** 换上新 ID 的块流（顺序、内容、parts 一律不动，**只动 `id`**） */
  blocks: Block[];
  /** 本次新铸的 ID（调用方可以据此提示"发现了 N 个新块"） */
  minted: readonly string[];
  /** 本次被认回来的退休块（取消缝合时非空 —— 界面可以据此说"已拆回 N 块"） */
  reclaimed: readonly string[];
}

/** 把 `dead` 从所有有效项的别名里摘掉（认回来之后它不再是别人的别名） */
function unalias(entries: RegistryEntry[], dead: string): void {
  for (const e of entries) {
    if (e.id === dead) continue;
    e.aliases = e.aliases.filter((a) => a !== dead);
  }
}

/**
 * 给块流冻结 ID。**同一份输入跑两遍得到同样的结果**（幂等），
 * 且第一遍之后内容怎么变（OCR 回填、缝合、手修）都不会改 ID。
 */
export function resolveIds(registry: BlockRegistry, blocks: readonly Block[]): ResolveResult {
  const entries = registry.entries.map(copyEntry);
  const retired = registry.retired.map(copyEntry);
  let nextSeq = registry.nextSeq;
  const minted: string[] = [];
  const reclaimed: string[] = [];
  const out: Block[] = [];

  for (const block of blocks) {
    let entry = entries.find((e) => partsNearlyEqual(e.parts, block.parts));

    if (entry === undefined) {
      const contained = entries.filter((e) => isSubset(e.parts, block.parts));
      if (contained.length > 0) {
        // 长大了（缝合）：最靠前的当赢家，其余退休
        contained.sort((a, b) => {
          const pa = firstPartOf(a.parts);
          const pb = firstPartOf(b.parts);
          return (pa?.page ?? 0) - (pb?.page ?? 0) || (pa?.bbox[1] ?? 0) - (pb?.bbox[1] ?? 0);
        });
        entry = contained[0]!;
        for (const loser of contained.slice(1)) {
          entry.aliases.push(loser.id, ...loser.aliases);
          const at = entries.indexOf(loser);
          if (at >= 0) entries.splice(at, 1);
          if (!retired.some((r) => r.id === loser.id)) retired.push(loser);
        }
      } else {
        const container = entries.find((e) => isSubset(block.parts, e.parts));
        // 拆开了：先在墓园里认回原块（它才是碎片真正的历史身份）
        const grave = retired.find((r) => partsNearlyEqual(r.parts, block.parts));
        if (grave !== undefined) {
          const at = retired.indexOf(grave);
          retired.splice(at, 1);
          // 认回来：它自己、以及它带回来的旧指纹，都不再是别人的别名
          unalias(entries, grave.id);
          for (const legacy of grave.aliases) unalias(entries, legacy);
          entries.push(grave);
          entry = grave;
          reclaimed.push(grave.id);
        } else if (container !== undefined) {
          // 认不回原块（这一块从来没单独登记过）：**第一个碎片继承容器的身份**，
          // 并把容器项收缩成它 —— 这样问在缝合块上的问答原地落在第一片，改名换姓也不会丢。
          // 用"继承"而不是"新铸一个再把容器降级成别名"，是因为容器那个 ID 之后还要继续用（是真实存在的块）。
          entry = container;
          entry.parts = copyParts(block.parts);
          entry.partsKey = partsKeyOf(block.parts);
        } else {
          const id = `b${nextSeq}`;
          nextSeq += 1;
          minted.push(id);
          entry = { id, partsKey: partsKeyOf(block.parts), parts: copyParts(block.parts), aliases: [] };
          entries.push(entry);
        }
      }
    }

    // 引擎的内容指纹形态记成别名 —— 升级前的存档靠这一条迁回来
    if (block.id !== entry.id && !entry.aliases.includes(block.id)) entry.aliases.push(block.id);

    out.push(block.id === entry.id ? block : { ...block, id: entry.id });
  }

  return {
    registry: { ...registry, nextSeq, entries, retired },
    blocks: out,
    minted,
    reclaimed,
  };
}

/** 从零给一份块流建档案（首次处理一份文档时用这个） */
export function registryFrom(blocks: readonly Block[], docId?: string): ResolveResult {
  return resolveIds(emptyRegistry(docId), blocks);
}

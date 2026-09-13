/**
 * 选模型。事实源：docs/CONTRACTS.md §6 + `ARCHITECTURE.md` §5 的成本分层。
 *
 * @anchor 分层是**成本**问题，不是能力问题：tier1 是便宜文本模型，
 *         tier2 是多模态贵模型。默认一律走 tier1 —— 代码讲解的绝大多数请求
 *         靠 `extractedText` 就够了，只有在"手里没有原文"或"模型明确说要看图"时才升级。
 *
 * 本文件属 orchestrator/，**禁止 import 'vscode'**。
 */

export type ModelTier = 'text' | 'vision';

export interface ModelRouteInput {
  /** 第几轮（1-based）。留着是为了将来做"第 N 轮之后换模型"，现在不影响决策 */
  turn: number;
  /** 锚点是否带上了原文（`extractedText`）。为空意味着模型看不到内容，必须升级 */
  hasExtractedText: boolean;
  /** 模型在上一轮明确要求看图（比如它说"看不清，需要图像"） */
  wantsImage: boolean;
}

export interface ModelChoice {
  tier: ModelTier;
  model: string;
  /** 为什么升到 tier2。写进日志，好在用户抱怨"怎么这么贵"时答得上来 */
  reason?: string;
}

export interface ModelRouterConfig {
  tier1Model: string;
  /** 未配置时**永远**走 tier1：宁可讲得糙，也不能因为少配一个字段就整个不能用 */
  tier2Model?: string;
}

export function createModelRouter(cfg: ModelRouterConfig): (input: ModelRouteInput) => ModelChoice {
  return (input) => {
    if (!cfg.tier2Model) return { tier: 'text', model: cfg.tier1Model };

    if (input.wantsImage) {
      return { tier: 'vision', model: cfg.tier2Model, reason: '模型要求看图' };
    }
    if (!input.hasExtractedText) {
      return { tier: 'vision', model: cfg.tier2Model, reason: '锚点没有原文，只能靠图' };
    }
    return { tier: 'text', model: cfg.tier1Model };
  };
}

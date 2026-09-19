/**
 * 风格实验台（D89）—— 讲解语言风格的系统性 A/B 对比。
 *
 * 线一：`docs/style-candidates.md` 里的候选风格全文，同锚点同温度各跑一遍，产出盲评稿。
 * 线二：`scripts/style-lab/exemplar/draft.md` 里用户改出来的"理想讲解"，
 *       原样注入 system prompt 的「示范」小节（few-shot）。
 *
 * 跑法（仓库根目录）：
 *
 *   ANCHOR_LAB_API_KEY=<DeepSeek 的 key> node packages/extension-anchor/scripts/style-lab.ts
 *
 * 可选参数：
 *   --model deepseek-flash     模型 id（默认 deepseek-flash，官方文档当前的模型之一；
 *                              另一档是 deepseek-v4-pro）
 *   --base-url <url>           默认 https://api.deepseek.com（官方文档的 OpenAI 兼容 base_url）
 *   --only B,D                 只跑列出的变体（按 `## 变体X` 的那个记号匹配）
 *   --temperature 0.7          默认 0.7 —— 各变体必须同温度，比较才成立
 *   --no-exemplar              不注入示范（对比"有/没有示范"的差别用）
 *   --dry-run                  不发请求：只组装 prompt 落盘，检查解析是否正确
 *
 * 产物（`.style-lab-out/`，已进 .gitignore）：
 *   blind/NN-<锚点>.md   盲评稿：变体匿名、编号乱序。按 README.md 的维度打分。
 *   key.md               答案表：NN → 变体。**评完再开**。
 *   open/<变体>/<锚点>.md 对照组（带变体名）；--dry-run 时另有完整 prompt。
 *   .cache.json          断点续跑：同 变体×锚点×模型×温度 的回答直接复用。
 *
 * 为什么不走扩展里的编排循环：这里不取件、不校验（锚点全文自带、行号天然合法），
 * 只复用**同一份 prompt 组装**（`buildSystemPromptWithStyleSection` / `buildUserPrompt`）
 * 与**同一份渲染**（`explanationMarkdown`）—— 比的是风格，其余两边一致。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSystemPromptWithStyleSection, buildUserPrompt } from '../src/prompts/index.ts';
import { explanationMarkdown } from '../src/session/exportNotes.ts';
import type { Anchor, ExplanationResult } from '@anchor/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const CANDIDATES_MD = join(REPO_ROOT, 'docs', 'style-candidates.md');
const ANCHORS_DIR = join(HERE, 'style-lab', 'anchors');
const EXEMPLAR_MD = join(HERE, 'style-lab', 'exemplar', 'draft.md');
const EXEMPLAR_MARKER = '<!-- ANCHOR_EXEMPLAR_START -->';

interface Variant {
  /** `## 变体X：…` 里的那个记号（A/B/…）。--only 与 open/ 目录名用它。 */
  id: string;
  title: string;
  /** 剥掉评审注释后的指令全文 —— 原样进 system prompt 的「说话的方式」一节 */
  text: string;
}

interface LabAnchor {
  name: string;
  focus: string | undefined;
  anchor: Anchor;
}

interface ParsedArgs {
  model: string;
  baseUrl: string;
  outDir: string;
  only: string[];
  temperature: number;
  useExemplar: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    outDir: join(REPO_ROOT, '.style-lab-out'),
    only: [],
    temperature: 0.7,
    useExemplar: true,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const next = (): string => argv[++i] ?? '';
    if (arg === '--model') args.model = next();
    else if (arg === '--base-url') args.baseUrl = next();
    else if (arg === '--out') args.outDir = next();
    else if (arg === '--only') args.only = next().split(',').map((s) => s.trim()).filter((s) => s !== '');
    else if (arg === '--temperature') args.temperature = Number(next());
    else if (arg === '--no-exemplar') args.useExemplar = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`不认识的参数：${arg}`);
  }
  if (!Number.isFinite(args.temperature)) throw new Error('--temperature 需要一个数字');
  return args;
}

/**
 * 从候选文档切出变体。**只认 `## 变体X：…` 开头的节**；`<!-- … -->` 注释是写给评审的，
 * 剥掉之后才算指令文本 —— 评审在注释里写什么都到不了模型那儿。
 */
function loadCandidates(): Variant[] {
  if (!existsSync(CANDIDATES_MD)) throw new Error(`找不到候选文档：${CANDIDATES_MD}`);
  const raw = readFileSync(CANDIDATES_MD, 'utf8');
  const sections = raw.split(/^## /mu).slice(1);
  const variants: Variant[] = [];
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const heading = (lines.shift() ?? '').trim();
    const match = /^变体([A-Za-z0-9]+)[：:]/u.exec(heading);
    if (!match) continue; // 文档里可能还有别的 `## ` 节（评审说明），不是变体
    const text = lines
      .join('\n')
      .replace(/<!--[\s\S]*?-->/gu, '')
      .trim();
    if (text === '') throw new Error(`变体${match[1]} 的指令是空的 —— 正文被删光了吗？`);
    variants.push({ id: match[1] ?? '', title: heading, text });
  }
  if (variants.length === 0) throw new Error('候选文档里没有解析出任何变体（要 `## 变体X：…` 的格式）');
  return variants;
}

/** focus 旁车文件（`<锚点名>.focus`）：`#` 开头的行是注释、空行忽略。 */
function loadFocus(name: string): string | undefined {
  const focusPath = join(ANCHORS_DIR, `${name}.focus`);
  if (!existsSync(focusPath)) return undefined;
  const focus = readFileSync(focusPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .join(' ')
    .trim();
  return focus === '' ? undefined : focus;
}

function loadAnchors(): LabAnchor[] {
  if (!existsSync(ANCHORS_DIR)) throw new Error(`找不到锚点目录：${ANCHORS_DIR}`);
  const names = readdirSync(ANCHORS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.endsWith('.focus'))
    .map((e) => e.name)
    .sort();
  if (names.length === 0) throw new Error(`锚点目录里没有样本：${ANCHORS_DIR}`);

  return names.map((name) => {
    const text = readFileSync(join(ANCHORS_DIR, name), 'utf8');
    const lineCount = text.replace(/\r\n/gu, '\n').replace(/\n$/u, '').split('\n').length;
    const anchor: Anchor = {
      sourceType: 'code',
      sourceId: `lab:${name}`,
      sourceName: name,
      // 整个文件就是锚点：自包含（不需要取件），行号天然合法
      location: { filePath: join(ANCHORS_DIR, name), lineStart: 1, lineEnd: lineCount },
      extractedText: text,
      focus: loadFocus(name),
    };
    return { name, focus: loadFocus(name), anchor };
  });
}

/** 示范文本 = `ANCHOR_EXEMPLAR_START` 标记之后的全部内容（用户改的就是那一段）。 */
function loadExemplar(): string | undefined {
  if (!existsSync(EXEMPLAR_MD)) return undefined;
  const raw = readFileSync(EXEMPLAR_MD, 'utf8');
  const at = raw.indexOf(EXEMPLAR_MARKER);
  if (at < 0) return undefined;
  const text = raw.slice(at + EXEMPLAR_MARKER.length).trim();
  return text === '' ? undefined : text;
}

function systemPromptFor(variant: Variant, exemplar: string | undefined): string {
  const base = buildSystemPromptWithStyleSection(variant.text);
  if (!exemplar) return base;
  return [
    base,
    '',
    '## 示范（输出的**长相与口吻**以此为准）',
    '',
    '下面是一份理想的讲解，讲的是这个产品的另一段代码。它的结构（summary / 第 N 步 / 子点与真实行号）',
    '和说话的口吻**照它来**；但内容必须全部来自用户这次的锚点 —— 不要把示范里的东西搬进去。',
    '',
    exemplar,
  ].join('\n');
}

function extractJson(text: string): ExplanationResult | null {
  const fence = /```json\s*([\s\S]*?)```/iu.exec(text) ?? /```\s*([\s\S]*?)```/u.exec(text);
  const candidates = [fence?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { steps?: unknown }).steps) &&
        typeof (parsed as { summary?: unknown }).summary === 'string'
      ) {
        return parsed as ExplanationResult;
      }
    } catch {
      // 试下一种切法
    }
  }
  return null;
}

async function chat(args: ParsedArgs, apiKey: string | undefined, system: string, user: string): Promise<string> {
  const url = `${args.baseUrl.replace(/\/+$/u, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: args.temperature,
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} —— ${await response.text().catch(() => '(无响应体)')}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content === '') throw new Error('模型回了空内容');
  return content;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const variants = loadCandidates();
  const anchors = loadAnchors();
  const exemplar = args.useExemplar ? loadExemplar() : undefined;
  const apiKey = args.dryRun ? undefined : process.env.ANCHOR_LAB_API_KEY;

  const picked = args.only.length === 0 ? variants : variants.filter((v) => args.only.includes(v.id));
  if (picked.length === 0) throw new Error(`--only 匹配不到变体（有：${variants.map((v) => v.id).join(', ')}）`);

  console.log(`变体 ${picked.length} 个（${picked.map((v) => v.id).join(' ')}） × 锚点 ${anchors.length} 个`);
  console.log(`模型 ${args.model} @ ${args.baseUrl}，温度 ${args.temperature}，示范 ${exemplar ? '注入' : '关闭'}`);
  if (args.dryRun) console.log('—— dry-run：不发请求，只落 prompt ——');
  else if (!apiKey) throw new Error('缺 ANCHOR_LAB_API_KEY 环境变量（或加 --dry-run 只看 prompt）');
  console.log(`产物目录：${args.outDir}`);

  const cachePath = join(args.outDir, '.cache.json');
  const cache: Record<string, { raw: string }> = existsSync(cachePath)
    ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, { raw: string }>)
    : {};

  mkdirSync(join(args.outDir, 'blind'), { recursive: true });
  mkdirSync(join(args.outDir, 'open'), { recursive: true });

  const keyLines: string[] = ['# 盲评答案表', '', '> 评完 blind/ 再开这份。格式：`盲评编号 → 变体`。', ''];
  let calls = 0;
  let failures = 0;

  for (let i = 0; i < anchors.length; i++) {
    const lab = anchors[i]!;
    const user = buildUserPrompt(lab.anchor, { focus: lab.focus });
    keyLines.push(`## ${lab.name}`, '');

    for (let j = 0; j < picked.length; j++) {
      const variant = picked[j]!;
      // 盲评编号：锚点 i 的第 j 个变体拿到 (i+j) mod n —— 每个锚点内编号各不相同，
      // 又没有一个"变体永远排第一"的固定位置。对应关系只进 key.md。
      const blindNo = ((i + j) % picked.length) + 1;
      const system = systemPromptFor(variant, exemplar);
      const cacheKey = `${variant.id}|${lab.name}|${args.model}|${args.temperature}|${exemplar ? 'ex' : 'noex'}`;

      let raw = cache[cacheKey]?.raw;
      if (raw === undefined && !args.dryRun) {
        calls += 1;
        process.stdout.write(`[${variant.id}] ${lab.name} … 请求中 `);
        try {
          raw = await chat(args, apiKey, system, user);
          cache[cacheKey] = { raw };
          writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
          process.stdout.write('ok\n');
        } catch (err) {
          failures += 1;
          process.stdout.write(`失败：${err instanceof Error ? err.message : String(err)}\n`);
          continue;
        }
      }

      const result = raw === undefined ? null : extractJson(raw);
      const body =
        result !== null
          ? explanationMarkdown({ result, anchor: lab.anchor, savedAt: Date.now() })
          : `> 这一份**没能解析出讲解 JSON** —— 原始回答附在文末。\n\n<details><summary>原始回答</summary>\n\n${raw ?? '（dry-run：未发请求）'}\n\n</details>\n`;

      const openDir = join(args.outDir, 'open', variant.id);
      mkdirSync(openDir, { recursive: true });
      writeFileSync(join(openDir, `${lab.name}.md`), body, 'utf8');
      if (args.dryRun) {
        writeFileSync(
          join(openDir, `${lab.name}.prompt.md`),
          `--- system ---\n${system}\n\n--- user ---\n${user}`,
          'utf8',
        );
      }
      // blind：文件名里只有编号与锚点，变体名只进 key.md
      writeFileSync(join(args.outDir, 'blind', `${pad2(blindNo)}-${lab.name}.md`), body, 'utf8');
      keyLines.push(
        `- \`${pad2(blindNo)}-${lab.name}.md\` → 变体${variant.id}（${variant.title.replace(/^变体[^\s:：]*[：:]\s*/u, '')}）`,
      );
    }
    keyLines.push('');
  }

  keyLines.push(
    '',
    `本次：变体 ${picked.map((v) => v.id).join(' ')}；模型 ${args.model}；温度 ${args.temperature}；` +
      `示范 ${exemplar ? '注入' : '关闭'}；真实调用 ${calls} 次，失败 ${failures} 次。`,
  );

  writeFileSync(join(args.outDir, 'key.md'), `${keyLines.join('\n')}\n`, 'utf8');
  writeFileSync(
    join(args.outDir, 'README.md'),
    [
      '# 盲评说明',
      '',
      '按**四个维度**给每份 blind/ 稿打分（1-5）或直接写批注：',
      '',
      '1. **像人话程度**（最优先：像不像一个懂的人在说话，而不是文档腔/翻译腔）',
      '2. 信息量（讲清了"为什么/带来什么"，还是复述了代码）',
      '3. 步骤切分是否顺着数据流（不是从上到下念）',
      '4. 位置与行号好不好懂',
      '',
      '同一编号（NN）下各锚点是**同一个变体** —— 按变体汇总分数，选出总分最高、单锚点不崩的那一个。',
      `答案在 key.md。本次模型 ${args.model}、温度 ${args.temperature}、示范 ${exemplar ? '已注入' : '关闭'}。`,
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(`完成：${calls} 次调用，${failures} 次失败。产物在 ${args.outDir}`);
  if (args.dryRun) console.log('（dry-run：open/<变体>/*.prompt.md 里是这次要发的完整 prompt，先检查再跑真的）');
}

main().catch((err: unknown) => {
  console.error(`style-lab 失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

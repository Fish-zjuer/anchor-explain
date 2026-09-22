/**
 * 块流视图模型的单测（D101）。
 *
 * @anchor 这一组盯的是**卡片上的号码**：页码标签（含跨页的 `第 12–13 页`）、
 *         徽标（发送位次）、悬停预览位次，以及"队列里有、卡片上没有"的那种
 *         必须报出来的情况。DOM 行为这个仓库里没有自动化覆盖（已知缺口 1），
 *         所以"数字对不对"必须在纯函数这一层被盯死 —— 它就是约束 107 的地基。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_QUEUE, enqueue, registryFrom } from '@anchor/pdf-blocks';
import type { Block, BlockIndex, BlockPart } from '@anchor/pdf-blocks';
import { blockViewOf, cardsSummary } from '../src/blocks/ui/model.ts';
import { renderBlockStreamHtml, esc } from '../src/blocks/ui/html.ts';

function part(page: number, y: number): BlockPart {
  return { page, bbox: [0.1, y, 0.9, y + 0.05] };
}

function block(id: string, parts: BlockPart[], text: string, kind: Block['kind'] = 'text'): Block {
  return { id, kind, text, parts, partTexts: parts.map(() => text) };
}

// 引擎的内容指纹 → 冻结 ID（D100）。真实链路上这一步紧随拆块
function frozen(blocks: Block[]): { blocks: Block[]; index: BlockIndex } {
  const { blocks: out } = registryFrom(blocks, 'doc');
  return { blocks: out, index: new Map(out.map((b) => [b.id, b])) };
}

function queueOf(...ids: string[]) {
  let q = EMPTY_QUEUE;
  for (const id of ids) q = enqueue(q, id).queue;
  return q;
}

/** 一块砖的视图 HTML（几处视觉断言共用；只造一块文本砖 —— 视觉规矩与块内容无关） */
function htmlOf(queued = 0): string {
  const { blocks, index } = frozen([block('f1', [part(1, 0.1)], '话。')]);
  const queue = queued > 0 ? queueOf(blocks[0]!.id) : EMPTY_QUEUE;
  return renderBlockStreamHtml('vscode-webview://x', {
    docLabel: '某教材',
    summary: '1 块',
    view: blockViewOf(blocks, queue, index),
    orderText: '顺序：按阅读序（自动）',
    queued,
  });
}

/** 从渲染出来的 HTML 里抠一条声明（**故意不重抄公式**：评的就是产物里那一份）。
    选择器要求**自成一行的规则头** —— 否则 .thumb 会先撞上别的规则里的同名尾巴。 */
function declOf(html: string, selector: string, prop: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = html.match(new RegExp(`(?:^|\\n)[ \\t]*${esc} \\{([^}]*)\\}`))?.[1];
  assert.ok(body !== undefined, `抠不到规则 ${selector}`);
  const m = body.match(new RegExp(`(?:^|[;{\\s])${prop}:\\s*([^;]+);`));
  assert.ok(m !== null, `规则 ${selector} 里没有 ${prop}`);
  return m[1]!;
}

/** 从 :root 里读一个数字旋钮（测试与 CSS 共用一份真相，不各写一份） */
function knobOf(html: string, name: string): number {
  const raw = declOf(html, ':root', name).trim();
  const m = raw.match(/^(-?[\d.]+)(deg|%|px)?$/);
  assert.ok(m !== null, `${name} 不是简单数字：${raw}`);
  return Number(m[1]);
}

test('页码标签：单页是"第 N 页"，跨页块是"第 N–M 页"（用户要的那种写法）', () => {
  const { blocks, index } = frozen([
    block('f1', [part(3, 0.1)], '单页的段落。'),
    block('f2', [part(12, 0.8), part(13, 0.1)], '一段话被分页截断，两头都在。'),
  ]);
  const view = blockViewOf(blocks, EMPTY_QUEUE, index);

  assert.equal(view.cards[0]?.pageLabel, '第 3 页');
  assert.equal(view.cards[0]?.multiPage, false);
  assert.equal(view.cards[1]?.pageLabel, '第 12–13 页');
  assert.equal(view.cards[1]?.multiPage, true);
  // 跨页块的两段正文都留着：卡片上要按"接缝"分开渲染
  assert.deepEqual(view.cards[1]?.partTexts, ['一段话被分页截断，两头都在。', '一段话被分页截断，两头都在。']);
});

test('徽标 = 发送位次；没入队的给"预览位次"，两者不共存', () => {
  const { blocks, index } = frozen([
    block('f1', [part(1, 0.5)], '下半页。'),
    block('f2', [part(1, 0.1)], '上半页。'),
    block('f3', [part(2, 0.1)], '第二页。'),
  ]);
  // 只选了"下半页"那一块（f1 → b1）
  const queue = queueOf(blocks[0]!.id);
  const view = blockViewOf(blocks, queue, index);

  const [下半, 上半, 第二页] = view.cards;
  assert.equal(下半?.badge, 1, '已入队：给发送位次');
  assert.equal(下半?.preview, undefined, '已入队的块不该再有预览位次');
  assert.equal(上半?.preview, 1, '它在上方，加进去会是第 1 个');
  assert.equal(上半?.badge, undefined);
  assert.equal(第二页?.preview, 2, '它在已选的下面，加进去会是第 2 个');
});

test('图注并进图卡：图块正文就是图注，图注块自己不再单独成卡（与重排稿同一个判据）', () => {
  const { blocks, index } = frozen([
    block('f1', [part(1, 0.3)], '', 'image'),
    block('f2', [part(1, 0.56)], '图 3.4 损失曲线'),
    block('f3', [part(1, 0.7)], '正文接着说。'),
  ]);
  const view = blockViewOf(blocks, EMPTY_QUEUE, index);

  assert.equal(view.cards.length, 2, '三块进、两张卡出');
  assert.equal(view.cards[0]?.kind, 'image');
  assert.equal(view.cards[0]?.text, '图 3.4 损失曲线', '图注成为图卡的正文');
  assert.equal(view.cards[0]?.captionId, blocks[1]!.id, '被并掉的图注 ID 要报出来（宿主据此清队列）');
  assert.equal(view.cards[1]?.text, '正文接着说。');
});

test('队列里存着被并掉的图注 ID：**折进图卡**（徽标可见 + 报给宿主改写），不是装作没看见', () => {
  const { blocks, index } = frozen([
    block('f1', [part(1, 0.3)], '', 'image'),
    block('f2', [part(1, 0.56)], '图 3.4 损失曲线'),
  ]);
  // 队列里存着图注块的 ID（它被并进了图卡，于是卡片上没有它）
  const queue = queueOf(blocks[1]!.id);
  const view = blockViewOf(blocks, queue, index);

  assert.equal(view.cards.length, 1);
  assert.equal(view.cards[0]?.badge, 1, '位次要折到图卡上，否则用户选了却看不见反馈（D81）');
  assert.equal(view.cards[0]?.preview, undefined);
  assert.equal(view.folded.get(blocks[1]!.id), blocks[0]!.id, '报给宿主去把队列改写成宿主块');
  assert.deepEqual([...view.orphans], [], '折进去的不算孤儿');
});

test('队列里存着这份块流根本没有的 ID：报进 orphans（发稿子之前就该发现）', () => {
  const { blocks, index } = frozen([block('f1', [part(1, 0.3)], '正文。')]);
  const queue = queueOf(blocks[0]!.id, '从别的文档来的ID');
  const view = blockViewOf(blocks, queue, index);

  assert.deepEqual([...view.orphans], ['从别的文档来的ID']);
  assert.equal(view.cards[0]?.badge, 1);
});

test('裁剪图按块 ID 查表喂进来；查不到就留空（渲染那边走占位，不假装有）', () => {
  const { blocks, index } = frozen([
    block('f1', [part(1, 0.3)], '', 'image'),
    block('f2', [part(1, 0.5)], '', 'image'),
  ]);
  const images = new Map([[blocks[0]!.id, 'data:image/png;base64,AAAA']]);
  const view = blockViewOf(blocks, EMPTY_QUEUE, index, { images });

  assert.equal(view.cards[0]?.imageUrl, 'data:image/png;base64,AAAA');
  assert.equal(view.cards[1]?.imageUrl, undefined);
});

test('空壳块标成 empty（渲染成薄薄一条），不跟正文一样占版面', () => {
  const { blocks, index } = frozen([block('f1', [part(1, 0.3)], '   '), block('f2', [part(1, 0.5)], '有字。')]);
  const view = blockViewOf(blocks, EMPTY_QUEUE, index);
  assert.equal(view.cards[0]?.empty, true);
  assert.equal(view.cards[1]?.empty, false);
});

test('统计那一句话：块数 / 图数 / 跨页数 / 已选 / 顺序', () => {
  const { blocks, index } = frozen([
    block('f1', [part(1, 0.1)], '正文。'),
    block('f2', [part(2, 0.3)], '', 'image'),
    block('f3', [part(3, 0.1), part(4, 0.1)], '跨页的话。'),
  ]);
  const summary = cardsSummary(blockViewOf(blocks, EMPTY_QUEUE, index), 0, '顺序：按阅读序（自动）');
  assert.match(summary, /3 块/);
  assert.match(summary, /图 1/);
  assert.match(summary, /跨页 1/);
  assert.match(summary, /还没选/);
  assert.match(summary, /按阅读序/);
});

test('HTML：正文里的尖括号被转义（PDF 抽出来的文字是不可信内容）', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');

  const { blocks, index } = frozen([block('f1', [part(1, 0.1)], '不等式 x < 3 且 y > 2')]);
  const html = renderBlockStreamHtml('vscode-webview://x', {
    docLabel: '某教材',
    summary: '1 块',
    view: blockViewOf(blocks, EMPTY_QUEUE, index),
    orderText: '顺序：按阅读序（自动）',
    queued: 0,
  });
  assert.doesNotMatch(html, /x < 3/, '原文里的 < 不许原样出现在 HTML 里');
  assert.match(html, /x &lt; 3/);
});

test('“静止”是用户骂出来的规矩（D105）、砖上一个变换都没有 —— 立体那七轮删干净了（D115）', () => {
  const html = htmlOf(1);

  // ① 选中的块**不许**有 animation（那条 3.2s 的"呼吸"就是被骂掉的东西）
  assert.doesNotMatch(html, /\.card\.selected\s*\{[^}]*animation/s, '选中态不许自走动画');
  assert.doesNotMatch(html, /anchor-breathe/, '呼吸动画不许回来');
  // ② 悬停/按下**不许**位移（密集网格里鼠标划过会让格子逐个上蹿一个像素）
  assert.doesNotMatch(html, /\.card:hover\s*\{[^}]*transform\s*:/s, '悬停不许位移');
  assert.doesNotMatch(html, /\.card:active\s*\{[^}]*transform\s*:/s, '按下不留位移（弹那一下由 .pop 负责）');
  // ③ **不许有整屏扫光**（做过一版 .cone，用户明确否掉）
  assert.doesNotMatch(html, /anchor-cone/, '扫光不许回来');
  assert.doesNotMatch(html, /class="cone"|lightCone/, '扫光那层元素与开关都不许回来');
  // ④ 唯一会动的是"指针的回执"：按下去的弹
  assert.match(html, /\.card\.pop\s*\{\s*animation: anchor-pop/, '按下去的弹必须留着');

  // ⑤ **立体那七轮（D106~D114）一个字都不留** —— 用户："去掉后面的所有设计吧，
  //    你根本实现不了我的想法，那都去掉吧，只留相册设计"。以下每一条都对应删掉的一层：
  assert.doesNotMatch(html, /\.window|\.plane|\.wall|\.glass/, '孔口 / 底面 / 坑壁 / 玻璃四层不许回来');
  assert.doesNotMatch(html, /--eye-x|--eye-y|@property/, '视线那两个变量与它的注册不许回来');
  assert.doesNotMatch(html, /--anchor-depth|--anchor-far|--anchor-tilt|--anchor-plane|--anchor-rim/,
    '坑的那五个几何旋钮不许回来');
  assert.doesNotMatch(html, /perspective|rotate[XY]?\(|matrix3d|preserve-3d|cqh|container-type/,
    '透视 / 旋转 / 3D / 容器查询单位都不许回来');
  // ⑥ 压在内容之上的那两片（用户说的"有一个固定遮罩在影响我看底面"）：暗角与玻璃反光
  assert.doesNotMatch(html, /blur\(/, '模糊不许回来');
  assert.doesNotMatch(html, /mask-composite|class="focus|--anchor-soft/, '对焦那两层与它的旋钮都不许回来');
  assert.doesNotMatch(html, /radial-gradient\(122% 108%/, '底面那圈暗角不许回来');
  assert.doesNotMatch(html, /linear-gradient\(146deg, rgba\(255, 255, 255, 0\.075\)/, '玻璃那道反光不许回来');
  assert.equal((html.match(/class="thumb"/g) ?? []).length, 1, '一块砖只有一份内容（不叠两层）');

  // ⑦ 减少动效的总开关：过渡与那一下弹都摘掉
  assert.match(html, /prefers-reduced-motion[\s\S]*?\.card, \.card-action, \.card-bar \{ transition: none; \}/, '减少动效时不缓动');
});

test('相册（D101/D115）：一层缩略图 + 一条底栏 + 一颗数字；等大、密集、方', () => {
  const html = htmlOf();

  // DOM：一张卡 = 缩略图 + 底栏 + 右上角那颗数字（内容就一层，没有别的容器）
  assert.match(html, /<div class="thumb"><div class="thumb-text">话。<\/div><\/div>\s*<div class="card-bar">/s,
    '缩略图直接就是这一块的表面');

  // 等大：方 + 网格列宽一致；密集：一道 4px 的窄缝；方一点：圆角 3px
  assert.equal(declOf(html, '.card', 'aspect-ratio'), '1 / 1', '每块等大（正方）');
  assert.equal(declOf(html, '.card', 'border-radius'), 'var(--anchor-radius)', '圆角');
  assert.equal(declOf(html, '.stream', 'gap'), 'var(--anchor-gap)', '密集：只有一道窄缝');
  assert.equal(declOf(html, '.stream', 'grid-template-columns'), 'repeat(auto-fill, minmax(var(--anchor-tile), 1fr))',
    '等宽列（auto-fill：面板多宽就排多少格）');
  assert.equal(knobOf(html, '--anchor-gap'), 4, '--anchor-gap = 4px（"稍微密一点"）');
  assert.equal(knobOf(html, '--anchor-radius'), 3, '--anchor-radius = 3px（"方一点"）');

  // 边框在**这一格自己**身上（不是里面某一层）：悬停 / 选中只换它的颜色，砖不动
  assert.equal(declOf(html, '.card', 'border'), '1px solid var(--vscode-panel-border)', '一格一圈细边');
  assert.match(html, /\.card:hover\s*\{[^}]*border-color:\s*var\(--vscode-focusBorder\)/s, '悬停只换边框色');
  assert.match(html, /\.card\.selected\s*\{[^}]*border-color:\s*var\(--vscode-focusBorder\)/s, '选中同理');

  // 缩略图：**不必完整** —— 底部渐隐（"这块还有下文"），内边距给底栏留位
  assert.match(html, /\.thumb-text\s*\{[^}]*mask-image:\s*linear-gradient\(to bottom, #000 72%, transparent 100%\)/s,
    '底部渐隐');
  assert.equal(declOf(html, '.thumb', 'padding'), '7px 8px calc(var(--anchor-bar) - 4px)', '底栏那条压的是空白处，不是字');
  // **没有黄光**（D110：用户"有一个异常的黄光，这不是我想要的效果"）
  assert.doesNotMatch(html, /255,\s*209,\s*128/, '那条暖黄高光不许回来');
});

test('相册的缩略图不必完整，但全文必须拿得到（悬停的 title 兜底）', () => {
  const long = '长句。'.repeat(400);
  const { blocks, index } = frozen([block('f1', [part(1, 0.1)], long)]);
  const html = renderBlockStreamHtml('vscode-webview://x', {
    docLabel: '某教材',
    summary: '1 块',
    view: blockViewOf(blocks, EMPTY_QUEUE, index),
    orderText: '顺序：按阅读序（自动）',
    queued: 0,
  });
  assert.ok(html.includes('title="第 1 页 · 加进去会是第 1 个'), 'title 开头是页码 + 位次');
  assert.ok(html.includes(long.slice(0, 600)), 'title 里带着正文（截到 600 字）—— 缩略图不完整，内容拿得到');
});

test('客户端（D115）：只剩指针那四件事 —— 视线跟随与所有几何都删干净了', async () => {
  const { BLOCK_VIEW_CLIENT_SCRIPT: script } = await import('../src/blocks/ui/clientScript.ts');

  // 指针的回执照旧：点选 / 滑选 / 弹 / 底部那三个按钮
  assert.match(script, /blocks:toggle/);
  assert.match(script, /blocks:range/);
  assert.match(script, /classList\.add\("pop"\)/);
  assert.match(script, /blocks:ask/);

  // 视线跟随（D111~D114）整段不在：没有那两个变量、不再量 rect、不再合帧
  assert.doesNotMatch(script, /--eye-x|--eye-y|EYE_MAX/, '那两个变量不许回来');
  assert.doesNotMatch(script, /getBoundingClientRect/, '不再量布局（那是视线那套的遗迹）');
  assert.doesNotMatch(script, /prefers-reduced-motion/, '减少动效那道早退只为视线存在，现在由 CSS 自己管');
  // 唯一的 requestAnimationFrame 是**重画后校正一次滚动位置**（S-P2：宿主每次变化都重设整个 HTML）
  assert.equal((script.match(/requestAnimationFrame/g) ?? []).length, 1, '只留重画后那一次滚动校正');
  assert.match(script, /setState\(\{ scrollTop: window\.scrollY \}\)/, '重画前把滚动位置交给 webview 状态');
  // 几何一条都不在这里：不碰变换，也不写任何自定义属性
  assert.doesNotMatch(script, /\.style\.transform|rotate|matrix|perspective|setProperty/, 'JS 不碰变换、不写变量');
  // 旧机制（D110 之前那套跟随变量）同样不许回来
  assert.doesNotMatch(script, /--tx|--ty|--px|--py|--shade/, '那几个跟随变量也不许回来');
});



test('内联字符串不许被模板插值咬坏（反引号 / ${ 是这一类白屏事故的根）', () => {
  const { blocks, index } = frozen([block('f1', [part(1, 0.1)], '话。')]);
  const html = renderBlockStreamHtml('vscode-webview://x', {
    docLabel: '某教材',
    summary: '1 块',
    view: blockViewOf(blocks, EMPTY_QUEUE, index),
    orderText: '顺序：按阅读序（自动）',
    queued: 0,
  });
  // 一个没被求值的 ${ 会**静默**留在 CSS/JS 里（不会抛错，只是样式或脚本坏掉），
  // 所以这条得断言 —— 反引号那种会当场语法错，不用测。
  assert.doesNotMatch(html, /\$\{/, '渲染结果里不许残留未求值的插值');
  assert.match(html, /--anchor-tile:/, '样式确实内联进来了（不是被截断只剩半截）');
});

test('CSP 放行 data: 图片（不放行的话所有图块会静默变空白）', () => {
  const html = renderBlockStreamHtml('vscode-webview://x', {
    docLabel: '某教材',
    summary: '1 块',
    view: { cards: [], folded: new Map(), orphans: [] },
    orderText: '顺序：按阅读序（自动）',
    queued: 0,
  });
  assert.match(html, /img-src vscode-webview:\/\/x data:/);
  assert.match(html, /default-src 'none'/);
  // 徽标两个取值都渲染进 DOM（悬停/选中由 CSS 切，不给第二份真相留机会）
  const { blocks, index } = frozen([block('f1', [part(1, 0.1)], '话。')]);
  const one = renderBlockStreamHtml('vscode-webview://x', {
    docLabel: '某教材',
    summary: '1 块',
    view: blockViewOf(blocks, queueOf(blocks[0]!.id), index),
    orderText: '顺序：按阅读序（自动）',
    queued: 1,
  });
  assert.match(one, /data-pos="1"/);
  assert.match(one, /data-preview=""/);
});

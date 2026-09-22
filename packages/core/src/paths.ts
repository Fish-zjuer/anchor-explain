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

// ─────────────────────────────────────────────────────────────
// 跨文件取件要用的路径运算（S9a）。**纯字符串，不碰文件系统**。
//
// @anchor 为什么不用 `node:path`：它是**平台相关**的（`resolve`/`isAbsolute`/`sep` 在 Windows 与
//         POSIX 上行为不同），而我们的测试要能在两个平台上给出同一个结论 —— 与上面
//         `basenameOf` 不用 `node:path.basename` 是同一个理由（D20/D29 的立场）。
//         这里两种分隔符都当分隔符、盘符单独处理，于是"同一条相对路径解析出的结果"
//         在哪个平台上都一致，也就能被单测钉住。
// ─────────────────────────────────────────────────────────────

/** 绝对路径吗：`C:\x`、`C:/x`、`\\server\share`、`/x`（POSIX 根）。 */
export function isAbsolutePath(p: string): boolean {
  return /^([A-Za-z]:[\\/]|\\\\|\/)/u.test(p);
}

/** 去掉最后一段（保留盘符或根）。`C:/a/b.c` → `C:/a`；`/a/b.c` → `/a`；`a.c` → `''`。 */
export function dirnameOf(p: string): string {
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const cut = normalized.lastIndexOf('/');
  if (cut < 0) return '';
  const head = normalized.slice(0, cut);
  // `C:/a` 再往上切会变成 `C:`（没有斜杠的盘符）—— 那种路径没法再往上，保持盘符原样
  return head === '' ? '/' : head;
}

/**
 * 把 `relative` 拼到 `base` 上并**归一化**（处理 `.` 与 `..`）。
 * `..` 走到根以外时停在根上（`/a/../..` → `/`），不产生越界的怪路径。
 */
export function joinPath(base: string, relative: string): string {
  const combined = `${base.replace(/\\/g, '/').replace(/\/+$/, '')}/${relative.replace(/\\/g, '/')}`;
  const drive = /^([A-Za-z]:)/u.exec(combined)?.[1] ?? '';
  const rest = drive === '' ? combined : combined.slice(drive.length);
  const rooted = rest.startsWith('/');
  const out: string[] = [];

  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0) out.pop();
      continue; // 已经在根上：`..` 无效，停在根
    }
    out.push(part);
  }

  const body = out.join('/');
  if (drive !== '') return `${drive}/${body}`;
  return rooted ? `/${body}` : body;
}

/**
 * `candidate` 在 `root` 里面吗（含二者相等）。
 *
 * 归一化用 `normPath` 的立场（两种斜杠等价、大小写不敏感）—— 与"同一个文件"的判断保持一致，
 * 否则会出现"闸门说在里面、播放器说是另一个文件"这种自相矛盾。
 */
export function isInsidePath(root: string, candidate: string): boolean {
  const r = normPath(root);
  const c = normPath(candidate);
  if (r === '' || c === '') return false;
  return c === r || c.startsWith(`${r}/`);
}

/**
 * 模型给的写法 → 一串**候选绝对路径**（按优先级，去重后）。**不做范围判断**。
 *
 * 顺序：相对路径**先按锚点文件所在目录**，再按各个 root；绝对路径只做归一化。
 * 两个出口的差别只在这里往下十行：`resolveCandidatePaths` 还要按 root 过滤，`resolveUnrestrictedPaths` 不过滤。
 */
function expandCandidates(given: string, anchorFile: string, roots: readonly string[]): string[] {
  const raw = given.trim();
  if (raw === '') return [];

  const candidates: string[] = [];
  if (isAbsolutePath(raw)) {
    candidates.push(normalizeAbsolute(raw));
  } else {
    if (dirnameOf(anchorFile) !== '') candidates.push(joinPath(dirnameOf(anchorFile), raw));
    for (const root of roots) {
      if (root !== '') candidates.push(joinPath(root, raw));
    }
  }

  const out: string[] = [];
  for (const candidate of candidates) {
    if (!out.some((p) => samePath(p, candidate))) out.push(candidate);
  }
  return out;
}

/**
 * 模型给的路径 → 一串**候选绝对路径**（按优先级，**已过滤到允许范围内**）。
 *
 * **落在所有 root 之外的候选一律丢掉** —— 这一步是刻意的：闸门批准的就是适配器会去读的，
 * 多留一个候选就等于留了一条"闸门没看过但会被读到"的路。
 * `roots` 为空 = 什么别的文件都读不到（连锚点目录下那一个候选也留不下）。
 *
 * @anchor 为什么"锚点目录"必须自己进 `roots`（D117）：模型的相对写法是**按锚点文件所在目录**算的
 *         （提示词与拒绝文案都这么教它），可锚点不一定在工作区里 —— 用「打开文件」而不是
 *         「打开文件夹」、或开发宿主窗口开在别的目录时，工作区根跟锚点毫无关系。
 *         那时 `../Inc/dshot_dma.h` 算出来的绝对路径既不在工作区根内、锚点目录又不是根，
 *         于是**连锚点旁边的那个文件都被判成"不在允许的范围内"**（用户实测的那条报错）。
 *         范围怎么算由此上移到 `relatedRoots`（orchestrator 侧）一处，这里只认 `roots`。
 *
 * 纯函数、不查存在性：不存在这件事由适配器回一句人话给模型（那是正常的工具结果，不是异常）。
 */
export function resolveCandidatePaths(
  given: string,
  anchorFile: string,
  roots: readonly string[],
): string[] {
  return expandCandidates(given, anchorFile, roots).filter((candidate) =>
    roots.some((root) => isInsidePath(root, candidate)),
  );
}

/**
 * 同上的展开，但**不按 root 过滤** —— 给"不限范围"那一档（`anchorExplain.fetchScope: "any"`）用。
 *
 * @anchor `any` 的含义就是"范围由路径本身说了算"：写绝对路径就按绝对路径读，写相对路径仍按
 *         锚点文件所在目录算。密钥/依赖/构建产物那道黑名单**不在这里**（它在闸门里，
 *         与档位无关：那是"不许发到远端模型"的底线，不是范围问题）。
 */
export function resolveUnrestrictedPaths(
  given: string,
  anchorFile: string,
  roots: readonly string[] = [],
): string[] {
  return expandCandidates(given, anchorFile, roots);
}

/** 绝对路径的归一化：盘符单独处理，UNC 与 POSIX 走同一套（比较时都归一化，不影响判断）。 */
function normalizeAbsolute(p: string): string {
  const drive = /^([A-Za-z]:)[\\/]?/u.exec(p);
  if (drive) return joinPath(`${drive[1]}/`, p.slice(drive[0].length));
  return joinPath('/', p.replace(/^[\\/]+/u, ''));
}

/**
 * `p` 相对 `root` 的写法（不在 root 内则原样返回）。**只用于给人/给模型看的清单**，
 * 不用于"是不是同一个文件"的判断（那个用 `samePath`）。
 */
export function relativeToPath(root: string, p: string): string {
  if (!isInsidePath(root, p)) return p;
  const r = normPath(root);
  const c = normPath(p);
  if (c === r) return '.';
  return p.slice(p.length - (c.length - r.length - 1)); // 用原串切，保留原大小写
}

/** 盘符 / UNC 共享名 / POSIX 根 —— 不同根的路径之间没法用 `..` 表达。 */
function rootKeyOf(p: string): string {
  const drive = /^([A-Za-z]:)/u.exec(p);
  if (drive) return drive[1]!.toLowerCase();
  const unc = /^([\\/]{2}[^\\/]+[\\/][^\\/]+)/u.exec(p);
  if (unc) return unc[1]!.replace(/\\/g, '/').toLowerCase();
  return p.startsWith('/') ? '/' : '';
}

/**
 * `p` 相对**某个目录**的写法，允许 `..`（`C:/fw/x/Src` + `C:/fw/x/Inc/a.h` → `../Inc/a.h`）。
 *
 * @anchor 为什么需要它（D117）：候选文件清单给模型看的是**相对于锚点文件所在目录**的名字，
 *         因为取件闸门解析相对路径正是先按那个目录算（`resolveCandidatePaths`）。
 *         原来清单里"不同目录"的那些写的是**工作区相对路径**（`Drivers/hal_gpio.h`）——
 *         两边基准不一样，于是模型照抄清单里的名字，解析出来的却是
 *         `<锚点目录>/Drivers/hal_gpio.h`：**一个不存在的路径**，白烧一轮取件
 *         （D96 那条 ENOENT 就是这么来的）。写成 `../../Drivers/hal_gpio.h` 之后，
 *         清单里的名字**按构造**就指向那个文件，不必再靠"存在性"去猜。
 *
 * 不同根（`C:` 与 `D:`、或 UNC 与本地盘）之间表达不出相对写法，**原样返回绝对路径** ——
 * 绝对路径同样合法（闸门那两档都收）。
 */
export function relativePathFrom(fromDir: string, p: string): string {
  const from = fromDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const to = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (rootKeyOf(from) === '' || rootKeyOf(from) !== rootKeyOf(to)) return p;

  const fromParts = from.split('/').filter((s) => s !== '');
  const toParts = to.split('/').filter((s) => s !== '');
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common]!.toLowerCase() === toParts[common]!.toLowerCase()
  ) {
    common += 1;
  }
  const parts = [...Array<string>(fromParts.length - common).fill('..'), ...toParts.slice(common)];
  return parts.length === 0 ? '.' : parts.join('/');
}

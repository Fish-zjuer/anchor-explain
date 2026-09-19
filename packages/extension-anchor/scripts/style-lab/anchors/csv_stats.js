// 读入一列 CSV 数值字符串，求均值与超过均值的行号（0 基）。
// 输入可能有空行、空串、非法数字 —— 都按"没有这一行"处理。
function csvStats(lines) {
  const values = [];
  const originalIndex = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text === "") continue;
    const n = Number(text);
    if (Number.isNaN(n)) continue;
    values.push(n);
    originalIndex.push(i);
  }

  if (values.length === 0) {
    return { mean: NaN, above: [] };   // 没有有效数据：均值没有意义
  }

  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;

  const above = [];
  for (let k = 0; k < values.length; k++) {
    if (values[k] > mean) above.push(originalIndex[k]);
  }

  return { mean, above };
}

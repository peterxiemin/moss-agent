// 计算购物车总价：满 100 打 9 折
export function totalPrice(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * (item.qty ?? 1);
  }
  if (sum >= 100) {
    sum *= 0.9;
  }
  return Math.round(sum * 100) / 100;
}

// 按名称去重，保留首次出现的商品
export function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!seen.has(item.name)) {
      seen.add(item.name);
      out.push(item);
    }
  }
  return out;
}

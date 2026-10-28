// 原作者的书法渲染接口。只调用 render 和 quota，从访问者浏览器直接请求。
// 本地地址或 ?mock=1 走模拟模式：返回 assets/ 里的样张，不发真实请求；本地带 ?mock=0 才发真实请求。

const BASE = 'https://ai.top915.top/shufa-api';

const params = new URLSearchParams(location.search);
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const MOCK = params.get('mock') === '1' || (local && params.get('mock') !== '0');

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// 模拟模式下的额度，只在本页内递减
let mockLeft = 10;

// 剩余额度：{ allowed, remaining }
export async function fetchQuota() {
  if (MOCK) return { allowed: mockLeft > 0, remaining: mockLeft };
  const r = await fetch(`${BASE}/api/quota?ref=&src=`);
  if (!r.ok) throw new ApiError('额度查询失败', r.status);
  const d = await r.json();
  return { allowed: d.allowed !== false && !(d.remaining <= 0), remaining: d.remaining };
}

// 生成一幅作品：poem 取自诗库，edition 为 trad/simp，style 为 zhalan/clean。
// 返回 { blob, format, remaining }；remaining 取自响应头，没有时为 null
export async function render(poem, edition, style) {
  const trad = edition === 'trad';
  const title = trad ? poem.t_trad : poem.t_simp;
  const author = trad ? poem.a_trad : poem.a_simp;
  const content = trad ? poem.c_trad : poem.c_simp;
  if (MOCK) {
    await new Promise((ok) => setTimeout(ok, 4200));
    if (mockLeft <= 0) throw new ApiError('额度已用完', 429);
    const r = await fetch(style === 'zhalan' ? 'assets/mock-zhalan.jpg' : 'assets/mock-clean.jpg');
    mockLeft -= 1;
    return { blob: await r.blob(), format: 'jpg', remaining: mockLeft };
  }
  const resp = await fetch(`${BASE}/api/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `《${title}》\n${author}\n${content}`, title, author, colophon: '',
      edition, style, poem_id: poem.id, no_watermark: false, hd_lossless: false })
  });
  if (!resp.ok) {
    let msg = `生成失败（${resp.status}）`;
    try {
      const j = await resp.json();
      if (typeof j.detail === 'string') msg = j.detail;
    } catch (e) { /* 响应不是 JSON 时用状态码提示 */ }
    throw new ApiError(msg, resp.status);
  }
  const left = resp.headers.get('X-Quota-Remaining');
  return { blob: await resp.blob(), format: resp.headers.get('X-Image-Format') || 'jpg', remaining: left === null ? null : Number(left) };
}

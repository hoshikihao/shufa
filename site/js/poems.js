// 诗库：读取 data/anthology.json，分类、搜索、正文分行

export const CATS = ['唐诗', '宋词', '诗经楚辞', '古文名篇', '经文国学'];

const HAN = /[㐀-鿿豈-﫿\u{20000}-\u{3134f}]/gu;

let loading = null;

// 全部诗词；每首加上 count（正文汉字数，不计标点）
export function loadPoems() {
  if (!loading) {
    loading = fetch('data/anthology.json')
      .then((r) => {
        if (!r.ok) throw new Error('诗库读取失败（' + r.status + '）');
        return r.json();
      })
      .then((list) => list.map((p) => ({ ...p, count: (p.c_simp.match(HAN) || []).length })));
  }
  return loading;
}

export function byCat(list, cat) {
  return list.filter((p) => p.cat === cat);
}

// 诗题、作者、正文里包含关键词的，繁简都查
export function search(list, q) {
  return list.filter((p) => [p.t_simp, p.a_simp, p.c_simp, p.t_trad, p.a_trad, p.c_trad].some((s) => s.includes(q)));
}

// 竖排展示用的正文：诗词每句一行，古文、经文连排
export function displayText(p) {
  if (p.cat === '古文名篇' || p.cat === '经文国学') return p.c_simp;
  return p.c_simp.replace(/([。！？])(?=.)/g, '$1\n');
}

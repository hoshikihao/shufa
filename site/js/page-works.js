// 我的：列出这台设备上生成过的作品，可下载、再写、删除
import { listWorks, deleteWork } from './works.js';

const $ = (id) => document.getElementById(id);
const gallery = $('gallery'), summary = $('summary'), empty = $('empty');

const LABELS = { trad: '繁体', simp: '简体', clean: '素笺', zhalan: '乌丝栏' };
const when = (t) => new Date(t).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function el(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

function count() {
  const n = gallery.children.length;
  summary.textContent = n ? `共 ${n} 幅` : '';
  gallery.hidden = n === 0;
  empty.hidden = n > 0;
}

function card(w) {
  const url = URL.createObjectURL(w.blob);
  const name = `${w.title.replace(/[\\/:*?"<>|]/g, '')}_星树书房.${w.format}`;
  const del = el('button', { type: 'button', textContent: '删除' });
  const li = el('li', {},
    el('a', { className: 'sheet', href: url, target: '_blank', rel: 'noopener', ariaLabel: `查看大图：${w.title}` },
      el('img', { src: url, alt: `小楷作品：${w.author}《${w.title}》`, loading: 'lazy' })),
    el('h2', { textContent: w.title }),
    el('p', { className: 'meta', textContent: `${w.author} · ${LABELS[w.edition]} · ${LABELS[w.style]}` }),
    el('p', { className: 'meta', textContent: when(w.time) }),
    el('div', { className: 'ops' },
      el('a', { href: url, download: name, textContent: '下载' }),
      el('a', { href: 'create.html?id=' + encodeURIComponent(w.poemId), textContent: '再写' }),
      del));
  del.addEventListener('click', async () => {
    if (!confirm(`删除《${w.title}》？删除后无法恢复。`)) return;
    await deleteWork(w.id);
    URL.revokeObjectURL(url);
    li.remove();
    count();
  });
  return li;
}

listWorks().then((list) => {
  gallery.append(...list.map(card));
  count();
}).catch(() => {
  summary.textContent = '读不到本机作品，浏览器可能禁用了本地存储';
});

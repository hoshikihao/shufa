// 选诗页：按分类浏览、搜索、查看全文。分类、搜索词、选中的诗记在网址里（?cat= ?q= ?id=）
import { CATS, loadPoems, byCat, search, displayText } from './poems.js';
import { reducedMotion } from './water.js';

const PAGE = 12;
const $ = (id) => document.getElementById(id);
const input = $('poemSearch'), catsEl = $('cats'), listEl = $('list'), label = $('resultLabel'), empty = $('empty'), more = $('more');

const params = new URLSearchParams(location.search);
const state = { cat: CATS.includes(params.get('cat')) ? params.get('cat') : null, q: (params.get('q') || '').trim(), id: params.get('id'), shown: PAGE };
let all = [];

function results() {
  return state.q ? search(all, state.q) : byCat(all, state.cat);
}

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q); else p.set('cat', state.cat);
  if (state.id) p.set('id', state.id);
  history.replaceState(null, '', '?' + p.toString());
}

function renderCats() {
  const counts = Object.fromEntries(CATS.map((c) => [c, byCat(all, c).length]));
  catsEl.replaceChildren(...CATS.map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(!state.q && name === state.cat));
    b.append(name);
    const n = document.createElement('small');
    n.textContent = counts[name];
    b.append(n);
    b.addEventListener('click', () => {
      state.cat = name;
      state.q = '';
      input.value = '';
      state.shown = PAGE;
      update();
    });
    return b;
  }));
}

function renderList() {
  const list = results();
  label.textContent = state.q ? `「${state.q}」找到 ${list.length} 首` : `${state.cat} · 共 ${list.length} 首`;
  listEl.replaceChildren(...list.slice(0, state.shown).map((p) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(p.id === state.id));
    for (const [cls, text] of [['t', p.t_simp], ['a', p.a_simp], ['n', p.count + ' 字']]) {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      b.append(s);
    }
    b.addEventListener('click', () => pick(p.id));
    li.append(b);
    return li;
  }));
  empty.hidden = list.length > 0;
  more.hidden = list.length <= state.shown;
}

function renderReader() {
  const p = all.find((x) => x.id === state.id);
  if (!p) return;
  $('poemTitle').textContent = p.t_simp;
  $('poemMeta').textContent = `${p.a_simp} · ${p.cat} · ${p.count} 字`;
  const text = $('poemText');
  text.textContent = displayText(p);
  text.scrollLeft = 0;
  $('toCreate').href = 'create.html?id=' + encodeURIComponent(p.id);
}

function update() {
  renderCats();
  renderList();
  renderReader();
  syncUrl();
}

function pick(id) {
  state.id = id;
  renderList();
  renderReader();
  syncUrl();
  // 窄屏上全文排在诗目下面，选中后滚过去
  const reader = $('reader');
  if (reader.getBoundingClientRect().top > window.innerHeight * 0.6) reader.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

// 拼音输入法拼字过程中不搜，选定汉字后再搜
function onSearch(e) {
  if (e.isComposing) return;
  state.q = input.value.trim();
  state.shown = PAGE;
  update();
}
input.addEventListener('input', onSearch);
input.addEventListener('compositionend', onSearch);

more.addEventListener('click', () => {
  state.shown += PAGE;
  renderList();
});

loadPoems().then((list) => {
  all = list;
  const chosen = all.find((p) => p.id === state.id);
  // 只给了诗没给分类时，打开那首诗所在的分类；什么都没给时默认古文名篇里的《爱莲说》
  if (!state.cat) state.cat = chosen ? chosen.cat : '古文名篇';
  if (!chosen) {
    const first = results()[0];
    state.id = state.cat === '古文名篇' && !state.q ? 'p0010' : first ? first.id : 'p0010';
  }
  input.value = state.q;
  update();
}).catch((e) => {
  label.textContent = e.message + '，请刷新重试。';
});

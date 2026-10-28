// 本机作品：生成成功的作品存进访问者浏览器的 IndexedDB，只在这台设备上，不上传

const DB = 'shufa', STORE = 'works';
let opening = null;

function openDb() {
  if (!opening) {
    opening = new Promise((ok, fail) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
  }
  return opening;
}

// 在一个事务里执行 fn(store)，事务完成后返回请求结果；空间不足时事务会 abort
async function run(mode, fn) {
  const db = await openDb();
  return new Promise((ok, fail) => {
    const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => ok(req.result);
    tx.onerror = tx.onabort = () => fail(tx.error);
  });
}

// work：{ poemId, title, author, edition, style, format, blob }
export const saveWork = (work) => run('readwrite', (s) => s.add({ ...work, time: Date.now() }));

// 新的在前
export const listWorks = () => run('readonly', (s) => s.getAll()).then((list) => list.reverse());

export const deleteWork = (id) => run('readwrite', (s) => s.delete(id));

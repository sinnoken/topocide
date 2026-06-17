// draft.js — localStorage 草稿共用邏輯（edit.html + index.html 共用）
// 以 window.Draft 暴露，兩頁皆可用（non-module + module script 均相容）
window.Draft = (() => {
  const KEY     = 'blastradius-draft';
  const MAX_AGE = 2 * 60 * 60 * 1000;  // 2 小時

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - (data._savedAt || 0) > MAX_AGE) { localStorage.removeItem(KEY); return null; }
      return data;
    } catch(e) { return null; }
  }

  function write(data) {
    try { localStorage.setItem(KEY, JSON.stringify({ ...data, _savedAt: Date.now() })); } catch(e) {}
  }

  function clear() { localStorage.removeItem(KEY); }

  return { KEY, MAX_AGE, read, write, clear };
})();

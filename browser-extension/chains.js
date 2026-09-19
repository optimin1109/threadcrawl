(() => {
  const postPattern = /^\/@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)\/post\/[A-Za-z0-9_-]+$/;
  const owner = id => {
    const match = typeof id === 'string' && id.match(postPattern);
    return match && match[0] === id ? match[1].toLowerCase() : null;
  };
  const sequence = total => Array.from({ length: total }, (_, index) => index + 1);
  const updatedAt = page => page.capturedAt || new Date().toISOString();
  function parseLabel(label) {
    const match = typeof label === 'string' && label.match(/^([1-9]\d{0,3})\/([1-9]\d{0,3})$/);
    if (!match || match[0] !== label) return null;
    const part = Number(match[1]), total = Number(match[2]);
    return part <= total && total <= 1000 ? { part, total } : null;
  }
  function candidates(page, knownChains = []) {
    if (!page || page.blocked || typeof page.account !== 'string') return [];
    const completed = new Set(knownChains.filter(chain => chain.status === 'complete').map(chain => chain.rootId));
    const roots = new Map();
    for (const card of page.cards || []) {
      const label = parseLabel(card.label);
      if (!label || label.part !== 1 || label.total <= 1 || owner(card.id) !== page.account.toLowerCase()
        || completed.has(card.id) || roots.has(card.id)) continue;
      roots.set(card.id, { rootId: card.id, total: label.total, status: 'pending', members: [],
        missing: sequence(label.total), reason: null, updatedAt: updatedAt(page) });
    }
    return [...roots.values()];
  }
  function observe(chain, page) {
    const author = owner(chain?.rootId), total = chain?.total;
    if (!author || !Number.isInteger(total) || total < 2 || total > 1000 || !page || page.blocked
      || page.view !== 'detail' || page.detailRoot !== chain.rootId || page.account?.toLowerCase() !== author) return chain;
    const byPart = new Map(), conflicts = new Set();
    const add = (part, id) => {
      if (!Number.isInteger(part) || part < 1 || part > total || owner(id) !== author || (part === 1 && id !== chain.rootId)) return;
      if (!byPart.has(part)) byPart.set(part, new Set());
      byPart.get(part).add(id);
    };
    for (const member of chain.members || []) add(member.part, member.id);
    // Keep conflicting IDs after serialization/restart; a later clean viewport
    // must not erase evidence that two different posts claimed the same number.
    for (const conflict of chain.conflicts || []) {
      if (Number.isInteger(conflict.part) && conflict.part >= 1 && conflict.part <= total) {
        conflicts.add(conflict.part);
        for (const id of conflict.ids || []) add(conflict.part, id);
      }
    }
    for (const card of page.cards || []) {
      const label = parseLabel(card.label);
      if (!label || label.total !== total || typeof card.text !== 'string'
        || !Array.isArray(card.issues) || card.issues.length) continue;
      add(label.part, card.id);
    }
    const partById = new Map();
    for (const [part, ids] of byPart) {
      if (ids.size > 1) conflicts.add(part);
      for (const id of ids) {
        const previous = partById.get(id);
        if (previous && previous !== part) { conflicts.add(previous); conflicts.add(part); }
        partById.set(id, part);
      }
    }
    const members = [...byPart].filter(([part]) => !conflicts.has(part))
      .sort(([a], [b]) => a - b).map(([part, ids]) => ({ part, id: [...ids][0] }));
    const found = new Set(members.map(member => member.part));
    const missing = sequence(total).filter(part => !found.has(part));
    const conflictList = [...conflicts].sort((a, b) => a - b).map(part => ({ part, ids: [...(byPart.get(part) || [])] }));
    const reason = conflictList.length ? `${conflictList.map(item => item.part).join(', ')}번 순번 충돌: 서로 다른 글 또는 번호가 관측되어 완료 확인 불가`
      : chain.conflictDetected ? chain.reason || '연속글 관계 충돌: 완료 확인 불가'
      : missing.length ? `빠진 번호: ${missing.join(', ')}` : null;
    const result = { ...chain, members, missing, status: missing.length || conflicts.size || chain.conflictDetected ? 'incomplete' : 'complete', reason, updatedAt: updatedAt(page) };
    if (conflictList.length) result.conflicts = conflictList;
    return result;
  }
  globalThis.threadsArchiveChains = { parseLabel, candidates, observe };
})();

(() => { const m = performance.memory; const g = globalThis.__GENESIS_GPUMEM__; const L = g ? g.lines() : [];
  return { used: Math.round(m.usedJSHeapSize / 1e6), total: Math.round(m.totalJSHeapSize / 1e6), lines: L.filter(l => /cpu retained|js heap/.test(l)) }; })()

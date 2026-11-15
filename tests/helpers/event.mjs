export function event() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    emit(...args) { return [...listeners].map(listener => listener(...args)); },
  };
}

const EMPTY = Object.freeze({ data: null, error: null, loading: true, refreshing: false, updatedAt: 0 });

/** Memory only. The owner must dispose the store when its authenticated session ends. */
export function createResourceStore(loadResource, { staleMs = 10_000, maxEntries = 32, now = Date.now } = {}) {
  const entries = new Map();
  let disposed = false;
  let leases = 0;

  function entryFor(key) {
    let entry = entries.get(key);
    if (!entry) {
      entry = { state: EMPTY, listeners: new Set(), request: null, controller: null, revision: 0 };
      entries.set(key, entry);
    }
    return entry;
  }

  function publish(entry, state) {
    entry.state = Object.freeze(state);
    entry.listeners.forEach((listener) => listener());
  }

  function prune() {
    if (entries.size <= maxEntries) return;
    for (const [key, entry] of entries) {
      if (!entry.request && !entry.listeners.size) entries.delete(key);
      if (entries.size <= maxEntries) break;
    }
  }

  function read(key, { force = false } = {}) {
    if (disposed) return Promise.resolve(null);
    const entry = entryFor(key);
    if (entry.request) return entry.request;
    if (!force && entry.state.data !== null && now() - entry.state.updatedAt < staleMs) {
      return Promise.resolve(entry.state.data);
    }
    const revision = ++entry.revision;
    const controller = new AbortController();
    entry.controller = controller;
    publish(entry, { ...entry.state, error: null, loading: entry.state.data === null, refreshing: true });
    const request = Promise.resolve().then(() => loadResource(key, controller.signal)).then((data) => {
      if (!disposed && entry.revision === revision) {
        publish(entry, { data, error: null, loading: false, refreshing: false, updatedAt: now() });
      }
      return data;
    }).catch((error) => {
      if (!disposed && entry.revision === revision) {
        const forbidden = [401, 403].includes(error?.status);
        publish(entry, { ...entry.state, data: forbidden ? null : entry.state.data,
          error, loading: false, refreshing: false });
      }
      throw error;
    }).finally(() => {
      if (entry.revision === revision) { entry.request = null; entry.controller = null; }
      prune();
    });
    entry.request = request;
    return request;
  }

  const store = {
    retain() {
      leases += 1;
      return () => {
        leases -= 1;
        // React StrictMode can release/reacquire the same committed store.
        queueMicrotask(() => { if (leases === 0) store.dispose(); });
      };
    },
    snapshot(key) { return disposed ? EMPTY : entryFor(key).state; },
    subscribe(key, listener) {
      if (disposed) return () => {};
      const entry = entryFor(key);
      entry.listeners.add(listener);
      return () => { entry.listeners.delete(listener); prune(); };
    },
    read,
    prefetch(key) { return read(key).catch(() => null); },
    update(key, transform) {
      if (disposed) return;
      const entry = entryFor(key);
      const data = transform(entry.state.data);
      if (data === null || data === undefined) return;
      // A pre-submission GET must not overwrite a subsequent server-accepted vote.
      entry.revision += 1;
      entry.controller?.abort(); entry.controller = null; entry.request = null;
      publish(entry, { data, error: null, loading: false, refreshing: false, updatedAt: now() });
      prune();
    },
    dispose() {
      disposed = true;
      entries.forEach((entry) => {
        entry.revision += 1;
        entry.controller?.abort();
        entry.listeners.clear();
      });
      entries.clear();
    },
  };
  return store;
}

/** Called only with the real POST /votes response, never before server acceptance. */
export function recordAcceptedVote(store, eventId, vote) {
  if (!vote || vote.eventId !== eventId || !['QUEUED', 'SUBMITTED', 'CONFIRMED'].includes(vote.status)) return;
  const eligibility = (event) => ({ ...event.eligibility, hasVoted: true });
  store.update(`event:${eventId}`, (event) => event && ({ ...event, vote, eligibility: eligibility(event) }));
  store.update('meetings', (events) => events?.map((event) => event.id === eventId
    ? { ...event, voteStatus: vote.status, voteCreatedAt: vote.createdAt,
      voteTransactionHash: vote.transactionHash, eligibility: eligibility(event) } : event));
}

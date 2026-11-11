// Slot pools for the expensive routes: a global and a per-client ceiling.

// waitMs > 0: a request over the limit waits up to that long for a slot before
// the 503 (at most `max` waiting), so a short burst queues instead of sending the
// client into its retry back-off.
export function createConcurrencyGuard(max, perClientMax = 0, { waitMs = 0, clientKey, backstopMs = 60_000 } = {}) {
  let active = 0;
  const activeByClient = new Map();
  const waiters = [];
  const hasRoom = (client) => active < max && !(perClientMax && (activeByClient.get(client) || 0) >= perClientMax);

  // A freed slot goes to the oldest waiter that may take it, so a new arrival
  // cannot jump the queue between the release and the waiter waking.
  const admitWaiters = () => {
    for (let i = 0; i < waiters.length && active < max;) {
      if (hasRoom(waiters[i].client)) {
        waiters.splice(i, 1)[0].admit();
      } else {
        i += 1;
      }
    }
  };

  const admit = (client, res, next) => {
    active += 1;
    activeByClient.set(client, (activeByClient.get(client) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      active = Math.max(0, active - 1);
      const remaining = (activeByClient.get(client) || 1) - 1;
      if (remaining > 0) {
        activeByClient.set(client, remaining);
      } else {
        activeByClient.delete(client);
      }
      admitWaiters();
    };
    // The slot is held until the admitted work ends, not until the client goes:
    // a disconnect leaves the fetch and decode running, so releasing on 'close'
    // let a client that kept disconnecting stack work past the ceiling. Guarded
    // handlers are wrapped in holdSlotUntilSettled, which releases when they
    // return. A client that leaves before its handler starts (mid-upload) frees
    // the slot at once; otherwise 'close' only arms a backstop.
    res.once("finish", release);
    res.once("close", () => {
      if (!res.locals.concurrencyWorkStarted) {
        release();
      } else if (!released) {
        setTimeout(release, backstopMs).unref();
      }
    });
    res.locals.releaseConcurrencySlot = release;
    next();
  };

  const refuse = (res) => {
    res.setHeader("retry-after", "1");
    res.status(503).json({ error: "Server busy, try again shortly" });
  };

  return function concurrencyGuard(req, res, next) {
    if (!max) {
      next();
      return;
    }
    const client = clientKey(req);
    if (hasRoom(client)) {
      admit(client, res, next);
      return;
    }
    if (!waitMs || waiters.length >= max) {
      refuse(res);
      return;
    }
    const waiter = { client, admit: () => settle(true) };
    const onClose = () => settle(false);
    const timer = setTimeout(() => settle(false), waitMs);
    function settle(granted) {
      clearTimeout(timer);
      res.off("close", onClose);
      const index = waiters.indexOf(waiter);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      if (granted && res.destroyed) {
        // Gone between the close event and the admit: pass the slot on.
        admitWaiters();
      } else if (granted) {
        admit(client, res, next);
      } else if (!res.headersSent && !res.destroyed) {
        refuse(res);
      }
    }
    res.once("close", onClose);
    waiters.push(waiter);
  };
}

const locks = new WeakMap<HTMLElement, { count: number; overflow: string }>();

/** Nested dialogs may be destroyed out of order when navigation or the session changes. */
export function lockDialogScroll(document: Document): () => void {
  const body = document.body;
  const state = locks.get(body) ?? { count: 0, overflow: body.style.overflow };
  state.count++;
  locks.set(body, state);
  body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.count === 0) {
      body.style.overflow = state.overflow;
      locks.delete(body);
    }
  };
}

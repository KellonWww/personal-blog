/** Progressive motion: content stays readable before hydration and without JavaScript. */
export function mountPageMotion(root: HTMLElement): () => void {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const selector = '[data-motion], .admin-content > *, .admin-metric, .admin-feed-item';
  const observed = new WeakSet<Element>();
  const pending = new Set<Element>();
  const animations = new Set<Animation>();
  const added = new Set<HTMLElement>();
  let frame = 0;
  const observer = new IntersectionObserver((entries) => {
    entries.filter((entry) => entry.isIntersecting).forEach(({ target, boundingClientRect }, index) => {
      observer.unobserve(target);
      pending.delete(target);
      if (preference.matches || !root.contains(target)) return;
      // Start below-fold entries before they become visible; keep late hydration subtle.
      const distance = boundingClientRect.top < window.innerHeight ? 6 : 12;
      const animation = target.animate([
        { translate: `0 ${distance}px` },
        { translate: '0 0' }
      ], { duration: 420, delay: Math.min(index * 24, 96), fill: 'backwards', easing: 'cubic-bezier(.22,1,.36,1)' });
      animations.add(animation);
      const release = () => animations.delete(animation);
      animation.addEventListener('finish', release, { once: true });
      animation.addEventListener('cancel', release, { once: true });
    });
  }, { threshold: 0, rootMargin: '0px 0px 72px 0px' });

  function register(element: HTMLElement) {
    if (observed.has(element)) return;
    // One owner per subtree prevents section and child animations from stacking.
    const ancestor = element.parentElement?.closest(selector);
    if (ancestor && root.contains(ancestor)) return;
    observed.add(element);
    pending.add(element);
    if (!preference.matches) observer.observe(element);
  }
  function observeTree(element: HTMLElement) {
    if (element.matches(selector)) register(element);
    element.querySelectorAll<HTMLElement>(selector).forEach(register);
  }
  function flushAdded() {
    frame = 0;
    pending.forEach((element) => {
      if (!root.contains(element)) {
        observer.unobserve(element);
        pending.delete(element);
      }
    });
    added.forEach((element) => {
      if (root.contains(element)) observeTree(element);
    });
    added.clear();
  }
  function syncPreference() {
    if (preference.matches) {
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      observer.disconnect();
    } else {
      pending.forEach((element) => observer.observe(element));
    }
  }
  observeTree(root);
  // React text updates need no scan; batch only inserted subtrees once per frame.
  const mutations = new MutationObserver((records) => {
    let removedElements = false;
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) added.add(node);
      });
      removedElements ||= Array.from(record.removedNodes).some((node) => node instanceof HTMLElement);
    });
    if (!frame && (added.size || removedElements)) frame = window.requestAnimationFrame(flushAdded);
  });
  mutations.observe(root, { childList: true, subtree: true });
  preference.addEventListener('change', syncPreference);
  return () => {
    observer.disconnect();
    mutations.disconnect();
    window.cancelAnimationFrame(frame);
    added.clear();
    pending.clear();
    preference.removeEventListener('change', syncPreference);
    animations.forEach((animation) => animation.cancel());
    animations.clear();
  };
}

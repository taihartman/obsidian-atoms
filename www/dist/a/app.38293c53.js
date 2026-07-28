/*
 * The only script on the site. Two jobs:
 *
 * 1. Story carousel: <main data-story> decides which storyline the CSS
 *    shows. This script just moves that attribute. With JS disabled the
 *    default story renders.
 * 2. Scroll reveals: section content rises in once as it enters the
 *    viewport, list items staggered. Skipped entirely under reduced
 *    motion, and everything stays visible without JS.
 */
(() => {
  const main = document.querySelector("main");

  // ---- story carousel ----
  const order = ["rel", "work", "self"];
  const labels = Array.from(document.querySelectorAll(".story-labels button"));

  const set = (story) => {
    main.dataset.story = story;
    for (const b of labels) {
      const active = b.dataset.story === story;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", String(active));
    }
  };

  for (const b of labels) {
    b.addEventListener("click", () => set(b.dataset.story));
  }

  for (const arrow of document.querySelectorAll(".story-arrow")) {
    arrow.addEventListener("click", () => {
      const i = order.indexOf(main.dataset.story);
      const n = order.length;
      set(order[(i + Number(arrow.dataset.dir) + n) % n]);
    });
  }

  // ---- scroll reveals ----
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;

  // The hero has its own choreography; reveals start at the first band.
  const targets = document.querySelectorAll(".band .wrap > *");
  for (const el of targets) el.classList.add("reveal");
  for (const list of document.querySelectorAll(".band .facts")) {
    Array.from(list.children).forEach((li, i) => {
      li.classList.add("reveal");
      li.style.transitionDelay = `${Math.min(i * 70, 350)}ms`;
      li.style.animationDelay = `${Math.min(i * 70, 350)}ms`;
    });
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );

  // Elements already on screen reveal in the same tick, so enabling the
  // hidden initial state never blanks what the visitor is looking at.
  requestAnimationFrame(() => {
    document.documentElement.classList.add("reveals-on");
    for (const el of document.querySelectorAll(".reveal")) {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) el.classList.add("in");
      else io.observe(el);
    }
  });
})();

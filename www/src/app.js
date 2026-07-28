/*
 * Story carousel. The only script on the site.
 *
 * All three storylines live in the HTML; <main data-story> decides which one
 * the CSS shows. This script just moves that attribute — arrows cycle,
 * labels jump. With JS disabled the default story still renders.
 */
(() => {
  const main = document.querySelector("main");
  const order = ["rel", "work", "self"];
  const labels = Array.from(
    document.querySelectorAll(".story-labels button"),
  );

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
})();

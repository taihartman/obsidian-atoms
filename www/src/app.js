/*
 * The only script on the site. Four jobs:
 *
 * 1. Story carousel: <main data-story> decides which storyline the CSS shows.
 * 2. Top bar: stuck state past the hero, plus the current-section highlight.
 * 3. Scroll reveals: section content rises in once as it enters the viewport.
 * 4. Graph: a real force-directed simulation on canvas, the way Obsidian's
 *    graph view behaves. Node/link data is read out of the server-rendered
 *    SVG, which stays as the no-JS fallback.
 *
 * With JS disabled everything is still readable: default story, plain bar
 * whose anchors still work, no reveal animation, static SVG graph.
 */
(() => {
  const main = document.querySelector("main");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- story carousel ---------------- */

  const order = ["rel", "work", "self"];
  const labels = Array.from(document.querySelectorAll(".story-labels button"));
  const onStoryChange = [];

  const set = (story) => {
    main.dataset.story = story;
    for (const b of labels) {
      const active = b.dataset.story === story;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", String(active));
    }
    for (const fn of onStoryChange) fn(story);
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

  /* ---------------- top bar ---------------- */

  const topbar = document.querySelector(".topbar");
  if (topbar) {
    // Keep the bar seamless over the hero; give it an edge once it overlaps content.
    const onScroll = () => topbar.classList.toggle("is-stuck", scrollY > 24);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const navLinks = new Map();
    for (const a of topbar.querySelectorAll(".topbar-links a")) {
      const section = document.querySelector(a.getAttribute("href"));
      if (section) navLinks.set(section, a);
    }

    // Highlight whichever section owns the band just below the bar.
    if (navLinks.size && "IntersectionObserver" in window) {
      const spy = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            for (const a of navLinks.values()) a.classList.remove("is-current");
            navLinks.get(e.target).classList.add("is-current");
          }
        },
        { rootMargin: "-56px 0px -72% 0px" },
      );
      for (const section of navLinks.keys()) spy.observe(section);
    }
  }

  /* ---------------- graph ---------------- */

  const VW = 360;
  const VH = 300;

  // Force constants. Tuned to Obsidian's feel: strong short-range repulsion,
  // soft links, weak gravity so clusters spread but never drift off-canvas.
  const REPULSION = 460;
  const LINK_DIST = 34;
  const LINK_K = 0.05;
  const GRAVITY = 0.006;
  const DAMPING = 0.84;
  const ALPHA_DECAY = 0.016;
  const ALPHA_MIN = 0.004;

  const css = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback;

  const rank = (n) =>
    n.g === "person" ? 0 : n.g === "hub" ? 1 : n.g === "atom" ? 2 : 3;

  const overlaps = (a, b) =>
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

  function initGraph(fig) {
    const svg = fig.querySelector("svg");
    if (!svg) return;

    const circles = Array.from(svg.querySelectorAll("circle"));
    const nodes = circles.map((c) => ({
      x: +c.getAttribute("cx"),
      y: +c.getAttribute("cy"),
      vx: 0,
      vy: 0,
      r: +c.getAttribute("r"),
      g: c.dataset.g,
      label: c.dataset.label || "",
    }));
    const links = Array.from(svg.querySelectorAll("line")).map((l) => [
      +l.dataset.a,
      +l.dataset.b,
    ]);

    const neighbors = nodes.map(() => new Set());
    for (const [a, b] of links) {
      neighbors[a].add(b);
      neighbors[b].add(a);
    }

    const canvas = document.createElement("canvas");
    canvas.className = "graph-canvas";
    fig.insertBefore(canvas, svg);
    fig.classList.add("has-canvas");
    const ctx = canvas.getContext("2d");

    // Dragging is for fine pointers only. On touch the canvas stays
    // non-interactive so it never steals a scroll gesture.
    const canDrag = matchMedia("(pointer: fine)").matches;
    if (canDrag) canvas.classList.add("is-interactive");

    let scale = 1;
    let alpha = 0;
    let raf = 0;
    let dragging = null;
    let hover = null;
    let pointer = { x: 0, y: 0 };

    const resize = () => {
      const w = fig.clientWidth || VW;
      scale = w / VW;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(VH * scale * dpr);
      canvas.style.height = `${Math.round(VH * scale)}px`;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      draw();
    };

    const colors = () => ({
      edge: css("--sep", "rgba(120,120,128,.4)"),
      soft: css("--graph-soft", "rgba(235,235,245,.32)"),
      tint: css("--tint", "#0a84ff"),
      person: css("--graph-person", "#ff9f0a"),
      label: css("--muted", "rgba(235,235,245,.6)"),
      strong: css("--label", "#fff"),
    });

    function nodeColor(n, c) {
      if (n.g === "person") return c.person;
      if (n.g === "hub" || n.g === "atom") return c.tint;
      return c.soft;
    }

    function step() {
      // Repulsion. n is ~45, so the naive O(n^2) pass is nothing.
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = 0.1;
            dy = 0.1;
            d2 = 0.02;
          }
          if (d2 > 22000) continue;
          const f = (REPULSION / d2) * alpha;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Links behave as springs toward a rest length.
      for (const [ai, bi] of links) {
        const a = nodes[ai];
        const b = nodes[bi];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = (d - LINK_DIST) * LINK_K * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      for (const n of nodes) {
        n.vx += (VW / 2 - n.x) * GRAVITY * alpha;
        n.vy += (VH / 2 - n.y) * GRAVITY * alpha;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        // Keep the whole graph on stage.
        n.x = Math.max(n.r + 12, Math.min(VW - n.r - 12, n.x));
        n.y = Math.max(n.r + 10, Math.min(VH - n.r - 14, n.y));
      }

      if (dragging) {
        dragging.x = pointer.x;
        dragging.y = pointer.y;
        dragging.vx = 0;
        dragging.vy = 0;
      }

      alpha = Math.max(0, alpha - ALPHA_DECAY * alpha);
    }

    function draw() {
      const c = colors();
      ctx.clearRect(0, 0, VW, VH + 20);

      const focus = dragging || hover;
      const lit = focus ? neighbors[nodes.indexOf(focus)] : null;
      const dim = (i) =>
        focus && nodes[i] !== focus && !(lit && lit.has(i)) ? 0.22 : 1;

      ctx.lineWidth = 1;
      for (const [ai, bi] of links) {
        const a = nodes[ai];
        const b = nodes[bi];
        ctx.globalAlpha = Math.min(dim(ai), dim(bi)) * 0.85;
        ctx.strokeStyle = c.edge;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        ctx.globalAlpha = dim(i);
        ctx.fillStyle = nodeColor(n, c);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Labels, most important first, skipping any that would collide. Real
      // graph views drop crowded labels rather than overprint them.
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const boxes = [];
      const ranked = nodes
        .map((n, i) => ({ n, i }))
        .filter((o) => o.n.label)
        .sort((a, b) => rank(a.n) - rank(b.n));

      for (const { n, i } of ranked) {
        const strong = n.g === "person" || n.g === "hub";
        ctx.font = `${strong ? 600 : 400} ${strong ? 10.5 : 9.5}px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`;
        const w = ctx.measureText(n.label).width;
        const h = strong ? 11 : 10;
        const x = n.x - w / 2;
        const y = n.y + n.r + 3.5;
        const box = [x - 2, y - 1, x + w + 2, y + h + 1];
        if (boxes.some((b) => overlaps(b, box))) continue;
        boxes.push(box);
        ctx.globalAlpha = dim(i);
        ctx.fillStyle = strong ? c.strong : c.label;
        ctx.fillText(n.label, n.x, y);
      }

      ctx.globalAlpha = 1;
    }

    function tick() {
      step();
      draw();
      if (alpha > ALPHA_MIN || dragging) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    }

    function reheat(a = 0.75) {
      alpha = Math.max(alpha, a);
      if (!raf) raf = requestAnimationFrame(tick);
    }

    /** Scatter outward so the settle reads as a graph assembling itself. */
    function scatter() {
      for (const n of nodes) {
        n.x = VW / 2 + (n.x - VW / 2) * 1.45;
        n.y = VH / 2 + (n.y - VH / 2) * 1.45;
        n.vx = 0;
        n.vy = 0;
      }
    }

    const at = (ev) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) / scale,
        y: (ev.clientY - r.top) / scale,
      };
    };

    const hit = (p) => {
      let best = null;
      let bestD = 14;
      for (const n of nodes) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < Math.max(n.r + 5, bestD) && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    };

    if (canDrag) {
      canvas.addEventListener("pointerdown", (ev) => {
        const p = at(ev);
        const n = hit(p);
        if (!n) return;
        dragging = n;
        pointer = p;
        canvas.setPointerCapture(ev.pointerId);
        canvas.classList.add("is-grabbing");
        reheat(0.5);
      });

      canvas.addEventListener("pointermove", (ev) => {
        const p = at(ev);
        if (dragging) {
          pointer = p;
          return;
        }
        const n = hit(p);
        if (n !== hover) {
          hover = n;
          canvas.classList.toggle("is-over", !!n);
          if (!raf) draw();
        }
      });

      const release = () => {
        if (!dragging) return;
        dragging = null;
        canvas.classList.remove("is-grabbing");
        reheat(0.35);
      };
      canvas.addEventListener("pointerup", release);
      canvas.addEventListener("pointercancel", release);
      canvas.addEventListener("pointerleave", () => {
        release();
        if (hover) {
          hover = null;
          canvas.classList.remove("is-over");
          if (!raf) draw();
        }
      });
    }

    addEventListener("resize", resize, { passive: true });
    resize();

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      if (reduceMotion) {
        // Settle without animating, then paint the result once.
        alpha = 1;
        for (let i = 0; i < 260; i++) step();
        alpha = 0;
        draw();
        return;
      }
      scatter();
      reheat(1);
    };

    return { start, resize, restart: start };
  }

  const graphs = [];
  for (const fig of document.querySelectorAll(".graph-fig")) {
    const g = initGraph(fig);
    if (g) graphs.push({ fig, ...g });
  }

  // A story switch reveals a different figure; size it now that it has a box.
  onStoryChange.push(() => {
    requestAnimationFrame(() => {
      for (const g of graphs) {
        if (g.fig.clientWidth) {
          g.resize();
          g.start();
        }
      }
    });
  });

  /* ---------------- scroll reveals ---------------- */

  if (!("IntersectionObserver" in window)) {
    for (const g of graphs) g.start();
    return;
  }

  const graphIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const g = graphs.find((x) => x.fig === e.target);
        if (g) g.start();
        graphIo.unobserve(e.target);
      }
    },
    { threshold: 0.25 },
  );
  for (const g of graphs) graphIo.observe(g.fig);

  if (reduceMotion) return;

  const targets = document.querySelectorAll(".band .wrap > *");
  for (const el of targets) el.classList.add("reveal");
  for (const list of document.querySelectorAll(".band .facts")) {
    Array.from(list.children).forEach((li, i) => {
      li.classList.add("reveal");
      li.style.transitionDelay = `${Math.min(i * 70, 350)}ms`;
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

  /* ---------------- Atoms Notes signup ---------------- */

  const notesMsg = {
    ok_new: "You're in. Check your email for a short welcome.",
    ok_existing: "You're already on the list. Glad you're here.",
    invalid_email: "Enter a valid email address.",
    rate_limited: "Too many tries. Wait a minute and try again.",
    upstream_error: "Something went wrong. Try again in a moment.",
    killed: "Signups are paused right now. Check back later.",
    network: "Could not reach the server. Check your connection and try again.",
  };

  for (const form of document.querySelectorAll("[data-notes-form]")) {
    const status = form.querySelector("[data-notes-status]");
    const emailInput = form.querySelector('input[name="email"]');
    const btn = form.querySelector('button[type="submit"]');
    if (!status || !emailInput || !btn) continue;

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      status.textContent = "";
      status.className = "notes-status";
      emailInput.setAttribute("aria-invalid", "false");

      const email = String(emailInput.value || "").trim();
      if (!email || !email.includes("@")) {
        status.textContent = notesMsg.invalid_email;
        status.classList.add("is-error");
        emailInput.setAttribute("aria-invalid", "true");
        emailInput.focus();
        return;
      }

      btn.disabled = true;
      status.textContent = "Joining…";
      status.classList.add("is-pending");

      const website = form.querySelector('input[name="website"]');
      try {
        const res = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            website: website ? website.value : "",
          }),
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        const code = data.code || (res.ok ? "ok_new" : "upstream_error");
        status.classList.remove("is-pending");
        if (res.ok && data.ok) {
          status.textContent = notesMsg[code] || notesMsg.ok_new;
          status.classList.add("is-ok");
          if (code === "ok_new") emailInput.value = "";
          status.focus?.();
        } else {
          status.textContent = notesMsg[code] || notesMsg.upstream_error;
          status.classList.add("is-error");
          if (code === "invalid_email") {
            emailInput.setAttribute("aria-invalid", "true");
            emailInput.focus();
          }
        }
      } catch {
        status.classList.remove("is-pending");
        status.textContent = notesMsg.network;
        status.classList.add("is-error");
      } finally {
        btn.disabled = false;
      }
    });
  }
})();

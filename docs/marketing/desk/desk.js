/* Atoms marketing desk — client. Loaded by index.html (generated). */
(function () {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () {
      t.classList.remove("show");
    }, 1400);
  }

  function copyText(text, btn) {
    function ok() {
      if (btn) {
        var prev = btn.textContent;
        btn.classList.add("copied");
        btn.textContent = "Copied";
        setTimeout(function () {
          btn.classList.remove("copied");
          btn.textContent = prev;
        }, 1200);
      }
      toast("Copied");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(function () {
        fallbackCopy(text, ok);
      });
    } else {
      fallbackCopy(text, ok);
    }
  }

  function fallbackCopy(text, ok) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      ok();
    } catch (e) {
      toast("Copy failed — select text and copy manually");
    }
    document.body.removeChild(ta);
  }

  function fmtValue(m) {
    if (m.value === null || m.value === undefined) return { text: "—", unk: true };
    if (m.unit === "usd") return { text: "$" + Number(m.value).toLocaleString(), unk: false };
    return { text: String(m.value), unk: false };
  }

  function badgeClass(status) {
    return "badge " + String(status || "").toLowerCase();
  }

  function isPending(item) {
    var s = String(item.status || "").toLowerCase();
    return s === "pending" || s === "todo";
  }

  function renderItem(item, primary) {
    var paste = item.paste || null;
    var titleId = "paste-title-" + item.id;
    var bodyId = "paste-body-" + item.id;
    var pasteHtml = "";

    if (paste && (paste.title || paste.body)) {
      pasteHtml = '<div class="paste-block">';
      if (paste.title) {
        pasteHtml +=
          '<p class="paste-label">Title</p>' +
          '<textarea class="paste-box" id="' +
          titleId +
          '" readonly>' +
          esc(paste.title) +
          "</textarea>" +
          '<div class="actions">' +
          '<button type="button" data-copy="' +
          titleId +
          '">Copy title</button></div>';
      }
      if (paste.body) {
        pasteHtml +=
          '<p class="paste-label" style="margin-top:14px">Body</p>' +
          '<textarea class="paste-box body" id="' +
          bodyId +
          '" readonly>' +
          esc(paste.body) +
          "</textarea><div class=\"actions\">" +
          '<button type="button" data-copy="' +
          bodyId +
          '">Copy body</button>';
        if (paste.title) {
          pasteHtml +=
            '<button type="button" class="secondary" data-copy-both="' +
            titleId +
            "|" +
            bodyId +
            '">Copy title + body</button>';
        }
        if (item.openUrl) {
          pasteHtml +=
            '<a class="btn secondary" href="' +
            esc(item.openUrl) +
            '" target="_blank" rel="noopener">' +
            esc(item.openLabel || "Open link") +
            "</a>";
        }
        pasteHtml += "</div>";
      } else if (item.openUrl) {
        pasteHtml +=
          '<div class="actions"><a class="btn" href="' +
          esc(item.openUrl) +
          '" target="_blank" rel="noopener">' +
          esc(item.openLabel || "Open link") +
          "</a></div>";
      }
      pasteHtml += "</div>";
    } else if (item.openUrl) {
      pasteHtml =
        '<div class="actions"><a class="btn" href="' +
        esc(item.openUrl) +
        '" target="_blank" rel="noopener">' +
        esc(item.openLabel || "Open link") +
        "</a></div>";
    }

    var links = (item.links || [])
      .map(function (l) {
        return (
          '<a href="' +
          esc(l.href) +
          '" target="_blank" rel="noopener">' +
          esc(l.label) +
          "</a>"
        );
      })
      .join(" · ");

    return (
      '<div class="card' +
      (primary ? " hero" : "") +
      '" style="margin-bottom:12px"><div class="row"><span class="' +
      badgeClass(item.status) +
      '">' +
      esc(item.status) +
      '</span><div class="body"><p class="title">' +
      esc(item.id) +
      " · " +
      esc(item.title) +
      "</p>" +
      (item.why ? '<p class="detail">' + esc(item.why) + "</p>" : "") +
      (item.youDo ? '<p class="steps">' + esc(item.youDo) + "</p>" : "") +
      pasteHtml +
      (item.decision ? '<p class="detail">Decision: ' + esc(item.decision) + "</p>" : "") +
      (item.effort ? '<p class="effort">~' + esc(item.effort) + "</p>" : "") +
      (links ? '<p class="effort">' + links + "</p>" : "") +
      "</div></div></div>"
    );
  }

  function render(state) {
    var b = state.budget || {};
    var spent = Number(b.spentThisMonthUsd || 0);
    var cap = Number(b.monthlyCapUsd || 200);
    var pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
    var q = state.queue || {};
    var items = q.items || [];
    var pending = items.filter(isPending);
    var primary = pending.filter(function (i) {
      return i.primary || i.paste;
    });
    var otherPending = pending.filter(function (i) {
      return primary.indexOf(i) === -1;
    });
    var doneItems = items.filter(function (i) {
      return !isPending(i);
    });

    var metrics = (state.metrics || [])
      .map(function (m) {
        var v = fmtValue(m);
        var inner =
          '<div class="lab">' +
          esc(m.label) +
          '</div><div class="val' +
          (v.unk ? " unk" : "") +
          '">' +
          esc(v.text) +
          "</div>" +
          (m.note ? '<div class="note">' + esc(m.note) + "</div>" : "");
        return m.href
          ? '<a class="metric" href="' +
              esc(m.href) +
              '" style="color:inherit;text-decoration:none">' +
              inner +
              "</a>"
          : '<div class="metric">' + inner + "</div>";
      })
      .join("");

    var foundation = (state.foundation || [])
      .map(function (f) {
        return (
          '<div class="row"><span class="' +
          badgeClass(f.status) +
          '">' +
          esc(f.status) +
          '</span><div class="body"><p class="title">' +
          esc(f.id) +
          " · " +
          esc(f.title) +
          '</p><p class="detail">' +
          esc(f.detail) +
          "</p></div></div>"
        );
      })
      .join("");

    var doNow = "";
    if (!pending.length) {
      doNow =
        '<div class="card"><div class="empty">Nothing for you. Marketing is healthy.</div></div>';
    } else {
      doNow = primary
        .map(function (i) {
          return renderItem(i, true);
        })
        .join("");
      doNow += otherPending
        .map(function (i) {
          return renderItem(i, false);
        })
        .join("");
    }

    var doneHtml = "";
    if (doneItems.length) {
      doneHtml =
        '<details class="done-section"><summary>Done this week (' +
        doneItems.length +
        ')</summary><div class="done-wrap" style="margin-top:10px">' +
        doneItems
          .map(function (i) {
            return renderItem(i, false);
          })
          .join("") +
        "</div></details>";
    }

    var linkPills = (state.links || [])
      .map(function (l) {
        return (
          '<a href="' +
          esc(l.href) +
          '" target="_blank" rel="noopener">' +
          esc(l.label) +
          "</a>"
        );
      })
      .join("");

    document.getElementById("app").innerHTML =
      "<header>" +
      '<p class="eyebrow">Atoms · internal desk</p>' +
      "<h1>Do this</h1>" +
      '<p class="north">“' +
      esc(state.northStar || "") +
      '”</p>' +
      (state.discoveryHome
        ? '<p class="meta">Discovery: ' + esc(state.discoveryHome) + "</p>"
        : "") +
      '<p class="meta">Updated ' +
      esc(state.updated) +
      (state.updatedNote ? " · " + esc(state.updatedNote) : "") +
      "</p></header>" +
      "<section><h2>Your actions</h2>" +
      (q.intro ? '<p class="intro">' + esc(q.intro) + "</p>" : "") +
      doNow +
      doneHtml +
      "</section>" +
      "<section><h2>Budget · " +
      esc(b.month || "") +
      '</h2><div class="card"><div class="row"><div class="body">' +
      '<p class="title">$' +
      esc(spent) +
      " of $" +
      esc(cap) +
      " this month</p>" +
      '<p class="detail">' +
      esc((state.spend && state.spend.rule) || "") +
      '</p><div class="budget-bar"><i style="width:' +
      pct +
      '%"></i></div></div></div></div></section>' +
      '<section><h2>Metrics</h2><div class="metrics">' +
      metrics +
      "</div></section>" +
      '<section><h2>Foundation</h2><div class="card">' +
      foundation +
      "</div></section>" +
      '<section><h2>Links</h2><div class="pill-links">' +
      linkPills +
      "</div></section>" +
      "<footer><p>SSOT <code>docs/marketing/state.json</code> · <code>npm run marketing-desk</code></p>" +
      "<p>" +
      esc(state.agentInstructions || "") +
      "</p></footer>";

    Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (btn) {
      btn.addEventListener("click", function () {
        var el = document.getElementById(btn.getAttribute("data-copy"));
        if (el) copyText(el.value, btn);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-copy-both]"), function (btn) {
      btn.addEventListener("click", function () {
        var parts = btn.getAttribute("data-copy-both").split("|");
        var t = document.getElementById(parts[0]);
        var body = document.getElementById(parts[1]);
        if (t && body) copyText(t.value + "\n\n" + body.value, btn);
      });
    });
  }

  function boot() {
    var el = document.getElementById("desk-state");
    var app = document.getElementById("app");
    if (!el || !app) return;
    try {
      render(JSON.parse(el.textContent));
    } catch (e) {
      app.innerHTML =
        "<p>Failed to load desk.</p><pre>" + esc(String(e && e.message ? e.message : e)) + "</pre>";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

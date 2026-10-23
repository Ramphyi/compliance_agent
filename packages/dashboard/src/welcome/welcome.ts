/**
 * The welcome page: theme (shared with the dashboard's `acai.theme` preference), reveal-on-scroll,
 * counters, the life-of-a-finding loop and copy buttons. Everything reads fine without it.
 */
const root = document.documentElement;
root.classList.add("js");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ theme
const THEME_KEY = "acai.theme";
const readTheme = () => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
};
const stored = readTheme();
if (stored) root.dataset.theme = stored;

document.getElementById("theme")?.addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* private window: the choice lasts for this page only */
  }
});

// ------------------------------------------------------------------ the big bowl next to "Start using"
// A copy of the header logo, so the markup lives in one place.
const logo = document.querySelector(".brand .logo");
document.querySelectorAll<HTMLElement>("[data-logo]").forEach((slot) => {
  if (!logo) return;
  const big = logo.cloneNode(true) as SVGElement;
  big.setAttribute("width", "240");
  big.setAttribute("height", "240");
  big.classList.add("logo--loop");
  slot.append(big);
});

// ------------------------------------------------------------------ counters
function countUp(el: HTMLElement) {
  const to = Number(el.dataset.count);
  if (reduced || !Number.isFinite(to) || to === 0) return;
  const start = performance.now();
  const ms = Math.min(1400, 500 + to * 2);
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  el.textContent = "0";
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ life of a finding
function lifeLoop(box: HTMLElement) {
  const status = box.querySelector<HTMLElement>("#life-status");
  const items = [...box.querySelectorAll<HTMLLIElement>("#life-log li")];
  if (!status || !items.length) return;
  const show = (label: string) => {
    status.textContent = label;
    status.dataset.s = label;
    status.classList.remove("pop");
    void status.offsetWidth; // restart the pop animation
    status.classList.add("pop");
  };
  if (reduced) {
    items.forEach((li) => li.classList.add("on"));
    show(items[items.length - 1].dataset.status ?? "Resolved");
    return;
  }
  let i = 0;
  const step = () => {
    if (i < items.length) {
      items[i].classList.add("on");
      show(items[i].dataset.status ?? "");
      i++;
      setTimeout(step, 1300);
    } else {
      setTimeout(() => {
        items.forEach((li) => li.classList.remove("on"));
        show("Open");
        i = 0;
        setTimeout(step, 1200);
      }, 3800);
    }
  };
  setTimeout(step, 700);
}

// ------------------------------------------------------------------ reveal on scroll
const started = new WeakSet<Element>();
const onVisible = (el: Element) => {
  el.classList.add("in");
  if (started.has(el)) return;
  started.add(el);
  el.querySelectorAll<HTMLElement>("[data-count]").forEach(countUp);
  if (el.id === "life") lifeLoop(el as HTMLElement);
};

const targets = document.querySelectorAll(".reveal, #report, #timeline, #life");
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          onVisible(e.target);
          io.unobserve(e.target);
        }
    },
    { rootMargin: "0px 0px -60px 0px", threshold: 0.08 },
  );
  targets.forEach((t) => io.observe(t));
} else targets.forEach(onVisible);

// The hero numbers count up right away.
document.querySelectorAll<HTMLElement>(".facts [data-count]").forEach(countUp);

// ------------------------------------------------------------------ copy buttons
document.querySelectorAll<HTMLButtonElement>(".code .copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.parentElement?.querySelector("pre")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    btn.textContent = "Copied";
    btn.classList.add("done");
    setTimeout(() => {
      btn.textContent = "Copy";
      btn.classList.remove("done");
    }, 1600);
  });
});

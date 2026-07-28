/* ============================================================
   Compact Series — section snapping + video scrubbing
   ============================================================ */

const video = document.getElementById("bg-video");
const panels = Array.from(document.querySelectorAll(".panel"));

const TRANSITION_MS = 1400; // lockout while a section transition plays
const SCRUB_RATE = 3.2;     // higher = video catches up to the section faster

let current = 0;
let locked = false;
let videoDuration = 10;     // updated from metadata
let targetTime = 0;
let displayTime = 0;

/* ---------- video loading ----------
   The full file is fetched into memory and attached as a blob URL.
   Seeking then never touches the network, which makes scrubbing
   instant and works around servers without HTTP range support
   (Safari refuses to seek — or even play — without it). */

async function loadVideo() {
  const src = video.dataset.src;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(res.statusText);
    const blob = await res.blob();
    video.src = URL.createObjectURL(blob);
  } catch {
    video.src = src; // e.g. opened via file:// where fetch is blocked
  }
}
loadVideo();

video.addEventListener("loadedmetadata", () => {
  videoDuration = video.duration;
  video.pause();
  video.currentTime = 0.001;
});

video.addEventListener("canplay", () => {
  video.classList.add("is-ready");
});

/* ---------- video scrub loop ---------- */

// Each section maps to a point in the video timeline.
function sectionTime(index) {
  const usable = videoDuration - 0.15; // stay clear of the final frame
  return (index / (panels.length - 1)) * usable;
}

// Continuous easing toward the target time gives the "slow scrub" feel.
// A new seek is only issued once the previous one finished — Safari
// silently drops seeks that are fired while one is still in flight.
let lastTick = performance.now();
function scrubLoop(now) {
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;
  const diff = targetTime - displayTime;
  if (Math.abs(diff) > 0.004 && video.readyState >= 2 && !video.seeking) {
    displayTime += diff * (1 - Math.exp(-dt * SCRUB_RATE));
    video.currentTime = displayTime;
  }
  requestAnimationFrame(scrubLoop);
}
requestAnimationFrame(scrubLoop);

/* ---------- section transitions ---------- */

function goTo(index) {
  if (locked || index < 0 || index >= panels.length || index === current) return;
  locked = true;

  const from = panels[current];
  const to = panels[index];

  from.classList.add("is-leaving");
  targetTime = sectionTime(index);

  // let the outgoing content fade before swapping panels
  setTimeout(() => {
    from.classList.remove("is-active", "is-leaving");
    to.classList.add("is-active");
  }, 420);

  current = index;
  setTimeout(() => { locked = false; }, TRANSITION_MS);
}

/* ---------- input: wheel ---------- */

let wheelAccum = 0;
window.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (locked) return;
    wheelAccum += e.deltaY;
    if (wheelAccum > 60) {
      wheelAccum = 0;
      goTo(current + 1);
    } else if (wheelAccum < -60) {
      wheelAccum = 0;
      goTo(current - 1);
    }
  },
  { passive: false }
);

/* ---------- input: touch ---------- */

let touchStartY = null;
window.addEventListener("touchstart", (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

window.addEventListener("touchend", (e) => {
  if (touchStartY === null) return;
  const delta = touchStartY - e.changedTouches[0].clientY;
  touchStartY = null;
  if (Math.abs(delta) < 40) return;
  goTo(current + (delta > 0 ? 1 : -1));
});

/* ---------- input: keyboard ---------- */

window.addEventListener("keydown", (e) => {
  if (["ArrowDown", "PageDown", " "].includes(e.key)) {
    e.preventDefault();
    goTo(current + 1);
  } else if (["ArrowUp", "PageUp"].includes(e.key)) {
    e.preventDefault();
    goTo(current - 1);
  }
});

/* ---------- CTAs ---------- */

document.querySelector(".btn-explore")?.addEventListener("click", () => goTo(1));

/* ---------- technology feature accordion ---------- */

const features = Array.from(document.querySelectorAll(".feature"));

features.forEach((feature) => {
  const head = feature.querySelector(".feature-head");
  if (!head) return;

  head.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !feature.classList.contains("is-open");

    features.forEach((other) => {
      other.classList.remove("is-open");
      other.querySelector(".feature-head")?.setAttribute("aria-expanded", "false");
    });

    if (willOpen) {
      feature.classList.add("is-open");
      head.setAttribute("aria-expanded", "true");
    }
  });
});

/* ---------- architecture hotspots (tap / click toggle) ---------- */

const hotspotGroups = Array.from(document.querySelectorAll(".hotspot-group"));

function closeAllHotspots(except = null) {
  hotspotGroups.forEach((group) => {
    if (group === except) return;
    group.classList.remove("is-open");
    group.querySelector(".hotspot")?.setAttribute("aria-expanded", "false");
  });
}

hotspotGroups.forEach((group) => {
  const btn = group.querySelector(".hotspot");
  if (!btn) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !group.classList.contains("is-open");
    closeAllHotspots(open ? group : null);
    group.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
});

document.addEventListener("click", () => closeAllHotspots());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllHotspots();
});

/* ---------- initial reveal ---------- */

// Re-trigger the hero reveal on load so the entrance animation plays.
window.addEventListener("load", () => {
  const hero = panels[0];
  hero.classList.remove("is-active");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => hero.classList.add("is-active"));
  });
});

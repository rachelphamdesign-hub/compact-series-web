/* ============================================================
   Compact Series — section snapping + video scrubbing
   ============================================================ */

const video = document.getElementById("bg-video");
const panels = Array.from(document.querySelectorAll(".panel"));

const TRANSITION_MS = 1500; // Mac trackpad lockout — slower section pacing
const TRANSITION_MS_WIN_MOUSE = 420; // Windows mouse notches
const TRANSITION_MS_PHONE = 1300; // phone: slower section pacing
const PANEL_SWAP_MS = 400;
const PANEL_SWAP_MS_PHONE = 360;
const SCRUB_RATE = 3.2; // Mac: slower video catch-up
const SCRUB_RATE_WIN = 6; // Windows: ease video catch-up with slower notches
const SCRUB_RATE_PHONE = 3; // phone: slower scrub
const TOUCH_THRESHOLD = 40;
const TOUCH_THRESHOLD_PHONE = 36; // phone: needs a clearer swipe
const IOS_SEEK_MIN_MS = 90; // iOS Safari freezes if currentTime is hammered

const isWindows = /Windows/i.test(navigator.userAgent);
const isIOS =
  /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const phoneMq = window.matchMedia("(max-width: 640px)");
const isPhone = () => phoneMq.matches;
const defaultLockMs = () => (isPhone() ? TRANSITION_MS_PHONE : TRANSITION_MS);
const panelSwapMs = () => (isPhone() ? PANEL_SWAP_MS_PHONE : PANEL_SWAP_MS);
const scrubRate = () => {
  if (isPhone()) return SCRUB_RATE_PHONE;
  if (isWindows) return SCRUB_RATE_WIN;
  return SCRUB_RATE;
};
const touchThreshold = () => (isPhone() ? TOUCH_THRESHOLD_PHONE : TOUCH_THRESHOLD);

let current = 0;
let locked = false;
let pendingStep = 0; // phone: keep one queued swipe so it never feels dead
let videoDuration = 10;     // updated from metadata
let targetTime = 0;
let displayTime = 0;
let lastSeekAt = 0;

/* ---------- video loading ----------
   Non-iOS: fetch into a blob so scrubbing never hits the network.
   iOS Safari: blob + frequent seeks freezes the page — use a direct
   ranged URL instead (Vercel serves Accept-Ranges: bytes). */

async function loadVideo() {
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  // Always use 1080p — the lighter mobile encode looked too soft on phones.
  const src = video.dataset.src;

  if (isIOS) {
    video.src = src;
    return;
  }

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
  try {
    video.currentTime = 0.001;
  } catch {
    /* iOS can throw if seek is not ready yet */
  }
  syncHotspotLayerToVideo();
});

video.addEventListener("canplay", () => {
  video.classList.add("is-ready");
});

video.addEventListener("seeked", () => {
  // Keep displayTime honest after Safari finishes a seek
  if (Number.isFinite(video.currentTime)) displayTime = video.currentTime;
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
    let step;

    if (isIOS) {
      // Few, spaced seeks — never per-frame. Stops the iPhone UI freeze.
      if (now - lastSeekAt < IOS_SEEK_MIN_MS) {
        requestAnimationFrame(scrubLoop);
        return;
      }
      step = Math.abs(diff) < 0.25 ? diff : diff * 0.55;
    } else {
      step = diff * (1 - Math.exp(-dt * scrubRate()));
      // Small catch-up on phone without a big snap
      if (isPhone() && Math.abs(diff) > 0.6) step = diff * 0.12;
    }

    displayTime += step;
    lastSeekAt = now;
    try {
      video.currentTime = displayTime;
    } catch {
      /* ignore illegal seek during load */
    }
  }
  requestAnimationFrame(scrubLoop);
}
requestAnimationFrame(scrubLoop);

/* ---------- section transitions ---------- */

function goTo(index, options = {}) {
  if (index < 0 || index >= panels.length || index === current) return;

  // Phone: queue one swipe during lock so input never feels frozen
  if (locked) {
    if (isPhone()) pendingStep = Math.sign(index - current) || pendingStep;
    return;
  }

  locked = true;
  pendingStep = 0;

  const from = panels[current];
  const to = panels[index];
  const lockMs = options.lockMs ?? defaultLockMs();

  from.classList.add("is-leaving");
  targetTime = sectionTime(index);

  // let the outgoing content fade before swapping panels
  setTimeout(() => {
    from.classList.remove("is-active", "is-leaving");
    to.classList.add("is-active");
  }, panelSwapMs());

  current = index;
  setTimeout(() => {
    locked = false;
    if (pendingStep) {
      const next = current + pendingStep;
      pendingStep = 0;
      goTo(next);
    }
  }, lockMs);
}

/* ---------- input: wheel ----------
   Trackpads send many small pixel deltas (macOS feels smooth with accumulation).
   Windows mice often use deltaMode=1 (lines) with tiny deltaY values — without
   normalizing, a notch never reaches the threshold and scroll feels broken. */

const WHEEL_THRESHOLD = 55; // Mac trackpad: need a fuller swipe per section
let wheelAccum = 0;
let wheelResetTimer = null;

function normalizeWheelDelta(e) {
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 40;              // lines → approx px
  else if (e.deltaMode === 2) dy *= window.innerHeight; // pages
  return dy;
}

window.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (locked) return;

    const dy = normalizeWheelDelta(e);
    if (dy === 0) return;

    // Discrete mouse notch (line mode, or one large jump): one section per tick
    const discreteMouse = e.deltaMode === 1 || e.deltaMode === 2 || Math.abs(dy) >= 80;
    if (discreteMouse) {
      wheelAccum = 0;
      goTo(current + (dy > 0 ? 1 : -1), {
        // Faster unlock only for Windows mouse notches — Mac trackpad / phone unchanged
        lockMs: isWindows ? TRANSITION_MS_WIN_MOUSE : TRANSITION_MS,
      });
      return;
    }

    // Continuous trackpad gesture: accumulate small pixel deltas
    wheelAccum += dy;
    clearTimeout(wheelResetTimer);
    wheelResetTimer = setTimeout(() => { wheelAccum = 0; }, 180);

    if (wheelAccum > WHEEL_THRESHOLD) {
      wheelAccum = 0;
      goTo(current + 1);
    } else if (wheelAccum < -WHEEL_THRESHOLD) {
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

window.addEventListener("touchcancel", () => {
  touchStartY = null;
}, { passive: true });

window.addEventListener("touchend", (e) => {
  if (touchStartY === null) return;
  const delta = touchStartY - e.changedTouches[0].clientY;
  touchStartY = null;
  if (Math.abs(delta) < touchThreshold()) return;
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

const techPanel = document.querySelector(".panel-tech");
const techCollapseBtn = document.querySelector(".tech-collapse");
const features = Array.from(document.querySelectorAll(".feature"));

techCollapseBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!techPanel) return;
  if (window.matchMedia("(max-width: 640px)").matches === false) return;

  const collapsed = techPanel.classList.toggle("is-collapsed");
  techCollapseBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  techCollapseBtn.setAttribute(
    "aria-label",
    collapsed ? "Expand feature list" : "Minimize feature list"
  );

  if (collapsed) {
    features.forEach((feature) => {
      feature.classList.remove("is-open");
      feature.querySelector(".feature-head")?.setAttribute("aria-expanded", "false");
    });
  }
});

window.matchMedia("(max-width: 640px)").addEventListener("change", (e) => {
  if (e.matches || !techPanel) return;
  techPanel.classList.remove("is-collapsed");
  techCollapseBtn?.setAttribute("aria-expanded", "true");
  techCollapseBtn?.setAttribute("aria-label", "Minimize feature list");
});

features.forEach((feature) => {
  const head = feature.querySelector(".feature-head");
  if (!head) return;

  head.addEventListener("click", (e) => {
    e.stopPropagation();
    if (techPanel?.classList.contains("is-collapsed")) return;

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
const hotspotLayer = document.querySelector(".hotspot-layer");

function parsePosKeyword(part, container, object) {
  const value = part.trim().toLowerCase();
  if (value === "center" || value === "centre") return 0.5 * (container - object);
  if (value === "left" || value === "top") return 0;
  if (value === "right" || value === "bottom") return container - object;
  if (value.endsWith("%")) {
    const pct = parseFloat(value) / 100;
    return Number.isFinite(pct) ? pct * (container - object) : 0.5 * (container - object);
  }
  if (value.endsWith("px")) {
    const px = parseFloat(value);
    return Number.isFinite(px) ? px : 0.5 * (container - object);
  }
  return 0.5 * (container - object);
}

/** Map hotspot % coords onto the same video frame the user sees (object-fit: cover). */
function syncHotspotLayerToVideo() {
  if (!hotspotLayer || !video) return;

  const ew = video.clientWidth;
  const eh = video.clientHeight;
  const iw = video.videoWidth;
  const ih = video.videoHeight;

  if (!ew || !eh || !iw || !ih) {
    hotspotLayer.style.inset = "0";
    hotspotLayer.style.width = "";
    hotspotLayer.style.height = "";
    hotspotLayer.style.left = "";
    hotspotLayer.style.top = "";
    return;
  }

  const scale = Math.max(ew / iw, eh / ih);
  const width = iw * scale;
  const height = ih * scale;
  const pos = getComputedStyle(video).objectPosition || "center center";
  const parts = pos.split(/\s+/);
  const left = parsePosKeyword(parts[0] || "center", ew, width);
  const top = parsePosKeyword(parts[1] || parts[0] || "center", eh, height);

  hotspotLayer.style.inset = "auto";
  hotspotLayer.style.left = `${left}px`;
  hotspotLayer.style.top = `${top}px`;
  hotspotLayer.style.width = `${width}px`;
  hotspotLayer.style.height = `${height}px`;
}

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
    const willOpen = !group.classList.contains("is-open");

    // Close any other pinned callout; toggle this one
    closeAllHotspots(willOpen ? group : null);
    hotspotGroups.forEach((g) => g.classList.remove("is-hover-locked"));
    group.classList.toggle("is-open", willOpen);
    btn.setAttribute("aria-expanded", willOpen ? "true" : "false");

    // After unpinning, suppress hover until the pointer leaves the dot
    if (!willOpen) group.classList.add("is-hover-locked");
  });

  group.addEventListener("mouseleave", () => {
    group.classList.remove("is-hover-locked");
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllHotspots();
});

window.addEventListener("resize", syncHotspotLayerToVideo);
window.addEventListener("orientationchange", () => {
  requestAnimationFrame(syncHotspotLayerToVideo);
});
window.addEventListener("load", syncHotspotLayerToVideo);
syncHotspotLayerToVideo();

/* ---------- initial reveal ---------- */

// Re-trigger the hero reveal on load so the entrance animation plays.
window.addEventListener("load", () => {
  const hero = panels[0];
  hero.classList.remove("is-active");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => hero.classList.add("is-active"));
  });
  syncHotspotLayerToVideo();
});

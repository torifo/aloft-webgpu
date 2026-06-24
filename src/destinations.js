// destinations.js — destination registry, menu UI, and hash routing.

export const DESTINATIONS = [
  { id: "fuji", name: "富士山", country: "日本", accent: "#7fd1ff", lang: "ja",
    tagline: "雲海の上にそびえる、孤高の冠雪の円錐。" },
  { id: "grandcanyon", name: "Grand Canyon", country: "USA", accent: "#ffb27f",
    tagline: "Layered chasm carved by the Colorado River." },
  { id: "himalaya", name: "Everest / Himalaya", country: "Nepal", accent: "#dbe6ff",
    tagline: "The roof of the world — extreme vertical scale." },
  { id: "guilin", name: "Guilin Karst", country: "China", accent: "#9af0c8",
    tagline: "A forest of limestone towers along the Li River." },
  { id: "fjord", name: "Geirangerfjord", country: "Norway", accent: "#7fe0ff",
    tagline: "Sheer cliff walls plunging into a glassy fjord." },
];

export function destById(id) {
  return DESTINATIONS.find((d) => d.id === id) || null;
}

/** Read #dest=<id> from the URL hash. */
export function readHash() {
  const m = /(?:^#|&)dest=([a-z0-9_-]+)/i.exec(location.hash);
  return m ? m[1] : null;
}

/** Write (or clear) the #dest hash without adding history entries. */
export function writeHash(id) {
  const next = id ? `#dest=${id}` : "#";
  if (location.hash !== next) history.replaceState(null, "", next);
}

/**
 * Build the Destinations menu overlay. Returns { el, show, hide, setStatus }.
 * `onPick(id)` fires when a card is chosen.
 */
export function createMenu(onPick) {
  const el = document.createElement("div");
  el.id = "menu";

  // Atmospheric horizon motif: layered ridgelines, golden-hour sun glow, and a
  // faint flight-path arc. Pure inline SVG — no external assets, no network.
  const horizon = `
    <svg class="menu-horizon" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice"
         aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="sunGlow" cx="50%" cy="100%" r="70%">
          <stop offset="0%" stop-color="#ffd9a8" stop-opacity=".55"/>
          <stop offset="35%" stop-color="#ffb27f" stop-opacity=".22"/>
          <stop offset="100%" stop-color="#ffb27f" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="ridgeFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3a4d76"/>
          <stop offset="100%" stop-color="#1a2440"/>
        </linearGradient>
        <linearGradient id="ridgeMid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#202d4d"/>
          <stop offset="100%" stop-color="#0c1226"/>
        </linearGradient>
        <linearGradient id="ridgeNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0e1426"/>
          <stop offset="100%" stop-color="#05080f"/>
        </linearGradient>
      </defs>
      <rect class="menu-horizon-glow" x="0" y="120" width="1440" height="400" fill="url(#sunGlow)"/>
      <path class="menu-flightpath" d="M-40 360 C 360 210, 900 150, 1500 250"
            fill="none" stroke="#cfe0ff" stroke-width="1.4" stroke-dasharray="5 11" opacity=".35"/>
      <path d="M0 300 L120 270 L260 300 L420 250 L600 296 L780 246 L980 300 L1180 262 L1320 296 L1440 274 L1440 520 L0 520 Z"
            fill="url(#ridgeFar)" opacity=".7"/>
      <path d="M0 360 L160 322 L320 372 L500 316 L700 372 L900 320 L1100 376 L1300 330 L1440 366 L1440 520 L0 520 Z"
            fill="url(#ridgeMid)" opacity=".88"/>
      <path d="M0 432 L200 392 L380 444 L560 400 L760 448 L980 398 L1180 450 L1380 404 L1440 430 L1440 520 L0 520 Z"
            fill="url(#ridgeNear)"/>
    </svg>`;

  el.innerHTML = `
    <div class="menu-sky" aria-hidden="true"></div>
    ${horizon}
    <div class="menu-inner">
      <header class="menu-head">
        <p class="menu-eyebrow">Cinematic glide tour · real terrain</p>
        <h1 class="menu-title">AlOft</h1>
        <p class="menu-sub">Choose a destination and soar. <span class="menu-esc">Press <kbd>Esc</kbd> to return to the menu.</span></p>
      </header>
      <ol class="manifest" role="list" aria-label="Destinations"></ol>
      <p class="menu-foot" id="menu-status" role="status" aria-live="polite"></p>
    </div>`;

  const list = el.querySelector(".manifest");
  DESTINATIONS.forEach((d, i) => {
    const li = document.createElement("li");
    li.className = "manifest-row";

    const card = document.createElement("button");
    card.className = "dest";
    card.type = "button";
    card.style.setProperty("--accent", d.accent);
    card.style.setProperty("--delay", `${i * 70}ms`);
    card.setAttribute("aria-label", `${d.name}, ${d.country} — ${d.tagline}`);
    if (d.lang) card.setAttribute("lang", d.lang);
    card.innerHTML = `
      <span class="dest-edge" aria-hidden="true"></span>
      <span class="dest-no" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
      <span class="dest-body">
        <span class="dest-name">${d.name}</span>
        <span class="dest-tag">${d.tagline}</span>
      </span>
      <span class="dest-meta">
        <span class="dest-country">${d.country}</span>
        <span class="dest-go" aria-hidden="true">Glide
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12h15M13 6l6 6-6 6"/>
          </svg>
        </span>
      </span>`;
    card.addEventListener("click", () => onPick(d.id));
    li.appendChild(card);
    list.appendChild(li);
  });

  document.body.appendChild(el);
  return {
    el,
    show() { el.classList.remove("hidden"); },
    hide() { el.classList.add("hidden"); },
    setStatus(msg) { const s = el.querySelector("#menu-status"); if (s) s.textContent = msg; },
  };
}

// destinations.js — destination registry, menu UI, and hash routing.

export const DESTINATIONS = [
  { id: "fuji", name: "Mount Fuji", country: "Japan", accent: "#7fd1ff",
    tagline: "Lone snow-capped cone above the cloud sea." },
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
  el.innerHTML = `
    <div class="menu-inner">
      <header class="menu-head">
        <h1>aloft</h1>
        <p class="menu-sub">Choose a terrain. Glide. Press <kbd>Esc</kbd> to return.</p>
      </header>
      <div class="cards" role="list"></div>
      <p class="menu-foot" id="menu-status"></p>
    </div>`;
  const cards = el.querySelector(".cards");
  for (const d of DESTINATIONS) {
    const card = document.createElement("button");
    card.className = "card";
    card.type = "button";
    card.setAttribute("role", "listitem");
    card.style.setProperty("--accent", d.accent);
    card.innerHTML = `
      <span class="card-glow"></span>
      <span class="card-id">${d.id}</span>
      <span class="card-name">${d.name}</span>
      <span class="card-country">${d.country}</span>
      <span class="card-tag">${d.tagline}</span>`;
    card.addEventListener("click", () => onPick(d.id));
    cards.appendChild(card);
  }
  document.body.appendChild(el);
  return {
    el,
    show() { el.classList.remove("hidden"); },
    hide() { el.classList.add("hidden"); },
    setStatus(msg) { const s = el.querySelector("#menu-status"); if (s) s.textContent = msg; },
  };
}

// Service worker : garde tout le programme sur l'appareil pour qu'il marche sans réseau. Modèle : construire.py remplit la version et la liste.
const VERSION = "6fff9c70bcb8";
const FICHIERS = {"app.js": 68522, "icone-192.png": 2387, "icone-512.png": 7095, "icone.svg": 407, "index.html": 1950, "manifest.webmanifest": 603, "moteur.zip": 70361, "polices/Manrope.woff2": 24376, "polices/OFL.txt": 4383, "pyodide/pyodide-lock.json": 112205, "pyodide/pyodide.asm.js": 1255688, "pyodide/pyodide.asm.wasm": 10105545, "pyodide/pyodide.js": 14913, "pyodide/python_stdlib.zip": 2360737, "pyodide/sqlite3-1.0.0-cp312-cp312-pyodide_2024_0_wasm32.whl": 563076, "style.css": 30378, "travailleur.js": 4483};
const CACHE = `tachoreader-${VERSION}`;

async function prevenir(message) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(message);
}

async function installer() {
  const cache = await caches.open(CACHE);
  const noms = Object.keys(FICHIERS);
  const total = noms.reduce((s, n) => s + FICHIERS[n], 0);
  let fait = 0;
  // un par un, du plus petit au plus gros : la barre de progression avance et une connexion faible n'est pas noyée
  for (const nom of noms.sort((a, b) => FICHIERS[a] - FICHIERS[b])) {
    const r = await fetch(nom, { cache: "reload" });
    if (!r.ok) throw new Error(`${nom} : ${r.status}`);
    await cache.put(nom, r);
    fait += FICHIERS[nom];
    prevenir({ installation: fait / total });
  }
  await cache.put("./", await cache.match("index.html"));
}

self.addEventListener("install", (e) => {
  e.waitUntil(installer().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) if (nom.startsWith("tachoreader-") && nom !== CACHE) await caches.delete(nom);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const garde = await cache.match(e.request, { ignoreSearch: true });
    if (garde) return garde;
    if (e.request.mode === "navigate") return (await cache.match("index.html")) || fetch(e.request);
    return fetch(e.request);
  })());
});

"use strict";
// L'interface de la PWA : aucun calcul ici. Tout vient du moteur Python (travailleur.js, moteur.py).

// ------------------------------------------------------------ outils
const $ = (s) => document.querySelector(s);
// Dans l'appli PC (Tauri), le lecteur de cartes est accessible : bouton « Lire ma carte ». Dans un navigateur, rien de plus.
const PC = window.__TAURI__ || null;

function el(tag, attrs, ...enfants) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (k === "value") n.value = v;
    else if (k === "checked" || k === "disabled" || k === "open" || k === "selected") n[k] = !!v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const e of enfants.flat(Infinity)) if (e !== null && e !== undefined && e !== false) n.append(e);
  return n;
}

function icone(chemin) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.9");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", chemin);
  svg.append(p);
  return svg;
}

const pad = (n) => String(n).padStart(2, "0");

function duree(m) {
  if (!m) return "—";
  const t = Math.round(m);
  return `${Math.floor(t / 60)}h${pad(t % 60)}`;
}

function euros(v) {
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

const nombre = (n) => n.toLocaleString("fr-FR");

function accorder(n, un, plusieurs) {
  return `${n} ${n > 1 ? plusieurs : un}`;
}

let animer = true;

function vibrer() {
  try {
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(8);
  } catch (e) { /* un simple plus */ }
}

function animationsActives() {
  return animer && !document.documentElement.classList.contains("calme") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Les chiffres défilent jusqu'à leur valeur
function chiffre(valeur, formater) {
  const n = el("span", {}, formater(valeur));
  if (!animationsActives() || !valeur) return n;
  const debut = performance.now();
  const pas = (t) => {
    const p = Math.min(1, (t - debut) / 650);
    const f = 1 - Math.pow(1 - p, 3);
    n.textContent = formater(p >= 1 ? valeur : valeur * f);
    if (p < 1 && n.isConnected !== false) requestAnimationFrame(pas);
  };
  requestAnimationFrame(pas);
  return n;
}

// Une valeur CSS qui part de zéro, pour laisser la transition jouer
function monter(n, propriete, valeur) {
  if (!animationsActives()) {
    n.style[propriete] = valeur;
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => { n.style[propriete] = valeur; }));
}

function toast(texte, options) {
  const o = options || {};
  const n = el("div", { class: `toast${o.erreur ? " erreur" : ""}`, role: "status" }, el("span", {}, texte));
  const partir = () => {
    n.classList.add("part");
    setTimeout(() => n.remove(), 220);
  };
  if (o.action) n.append(el("button", { type: "button", onclick: () => { partir(); o.action.faire(); } }, o.action.texte));
  $("#toasts").append(n);
  if (!o.reste) setTimeout(partir, o.erreur ? 6000 : 3200);
}

function memoire(cle, valeur) {
  // Simple confort : le navigateur peut refuser, la page marche sans
  try {
    if (valeur === undefined) return localStorage.getItem(cle);
    localStorage.setItem(cle, valeur);
  } catch (e) { /* rien */ }
  return null;
}

// ------------------------------------------------------------ moteur
let travailleur = null;
let numero = 0;
const attentes = new Map();

function q(action, args, extra) {
  return new Promise((ok, non) => {
    const id = ++numero;
    attentes.set(id, [ok, non]);
    travailleur.postMessage({ id, action, args, ...(extra || {}) });
  });
}

function surMessage(e) {
  const d = e.data;
  if (d.id) {
    const [ok, non] = attentes.get(d.id);
    attentes.delete(d.id);
    if (d.erreur) non(new Error(d.erreur));
    else ok(d.reponse);
  } else if (d.avancer) {
    avancerDemarrage(d.avancer, d.part);
  } else if (d.pret) {
    moteurPret();
  } else if (d.echec) {
    echecDemarrage(d.echec);
  }
}

function avancerDemarrage(texte, part) {
  $("#demarrage-texte").textContent = texte;
  $("#demarrage-part").style.width = `${Math.round(part * 100)}%`;
}

function echecDemarrage(detail) {
  avancerDemarrage("Le programme n'a pas pu démarrer.", 1);
  const note = $("#demarrage-note");
  note.replaceChildren(el("span", {}, `Détail : ${detail}`), el("br"), el("button", { class: "btn", type: "button", style: "margin-top:10px", onclick: () => location.reload() }, "Réessayer"));
}

// ------------------------------------------------------------ hors ligne et mises à jour
function preparerHorsLigne() {
  return new Promise((fini) => {
    if (PC || !("serviceWorker" in navigator)) return fini(); // l'appli PC a déjà tous ses fichiers
    const sw = navigator.serviceWorker;
    const dejaLa = !!sw.controller;
    sw.addEventListener("message", (e) => {
      if (e.data && e.data.installation !== undefined && !sw.controller) {
        avancerDemarrage(`Téléchargement du programme : ${Math.round(e.data.installation * 100)} %`, e.data.installation);
        $("#demarrage-note").textContent = "Une seule fois : ensuite il marche sans réseau.";
      }
    });
    sw.addEventListener("controllerchange", () => {
      fini();
      if (dejaLa) toast("Nouvelle version prête.", { reste: true, action: { texte: "Relancer", faire: () => location.reload() } });
    });
    if (dejaLa) fini();
    sw.register("sw.js").then((r) => {
      const suivi = r.installing;
      if (suivi) suivi.addEventListener("statechange", () => { if (suivi.state === "redundant") fini(); }); // installation ratée : on continue quand même, avec le réseau
    }).catch(() => fini());
    setTimeout(fini, 90000);
  });
}

// ------------------------------------------------------------ état général
let etat = {};
let demo = false;
let M = null; // mois affiché : {a, m}
let routeActuelle = null;

const NOMS_MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

async function relireEtat(garderMois) {
  etat = await q("etat");
  if (!garderMois || !M) M = etat.mois ? { a: etat.mois[0], m: etat.mois[1] } : null;
  poserApparence(etat.theme, etat.animations);
  $("#bandeau-demo").hidden = !demo;
}

function poserApparence(theme, animations) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("calme", !animations);
  memoire("theme", theme);
  memoire("animations", animations ? "1" : "0");
  document.querySelector('meta[name="theme-color"]').content = theme === "sombre" ? "#17150F" : "#F5F1E8";
}

function poserSoleil(oui) {
  // Plein soleil : le verre et les cartes deviennent opaques, pour lire dehors. Réglage propre à cet appareil.
  document.documentElement.classList.toggle("soleil", oui);
  memoire("soleil", oui ? "1" : "0");
}

// ------------------------------------------------------------ navigation
const I = {
  accueil: "M3 11.5 12 4l9 7.5M5.5 9.8V20h13V9.8M10 20v-6h4v6",
  mois: "M4 6h16v14H4zM4 10h16M8 3.5V7M16 3.5V7",
  infractions: "M12 4 2.8 20h18.4zM12 10v4.5M12 17.5v.1",
  paie: "M3.5 7h17v11h-17zM3.5 11h17M7 15h3",
  plus: "M5 12h.1M12 12h.1M19 12h.1",
  semaines: "M4 20V10M10 20V5M16 20v-7M21 20H3",
  jours: "M4 6h16M4 12h16M4 18h16",
  annee: "M4 20h16M6.5 20v-5M12 20V8M17.5 20v-9",
  reglages: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  ajout: "M12 5v14M5 12h14",
};

const PAGES = {
  accueil: { titre: "Accueil", rendre: pageAccueil },
  mois: { titre: "Mois", rendre: pageMois },
  infractions: { titre: "Infractions", rendre: pageInfractions },
  paie: { titre: "Paie", rendre: pagePaie },
  semaines: { titre: "Semaines", rendre: pageSemaines, secondaire: true },
  jours: { titre: "Jours", rendre: pageJours, secondaire: true },
  annee: { titre: "Année", rendre: pageAnnee, secondaire: true },
  reglages: { titre: "Réglages", rendre: pageReglages, secondaire: true },
};
const ORDRE = ["accueil", "mois", "semaines", "jours", "infractions", "paie", "annee", "reglages"];

function construireNav() {
  const nav = $("#nav");
  nav.append(el("div", { class: "nav-logo" }, el("img", { src: "icone-192.png", alt: "", width: 30, height: 30 }), "TachoReader"));
  nav.append(el("div", { id: "indicateur" }));
  for (const id of ORDRE) {
    nav.append(el("button", { type: "button", class: `nav-btn${PAGES[id].secondaire ? " secondaire" : ""}`, "data-page": id, onclick: () => aller(id) }, icone(I[id]), el("span", {}, PAGES[id].titre)));
  }
  nav.append(el("button", { type: "button", class: "nav-btn plus", onclick: ouvrirPlus }, icone(I.plus), el("span", {}, "Plus")));
  nav.append(el("div", { class: "nav-ajout" }, boutonCarte(), el("button", { type: "button", class: `btn${PC ? "" : " fort"}`, onclick: choisirFichier }, "Ajouter un fichier")));
  addEventListener("resize", placerIndicateur);
}

function placerIndicateur() {
  const nav = $("#nav");
  const large = matchMedia("(min-width: 740px)").matches;
  const choisi = [...nav.querySelectorAll(".nav-btn")].find((b) => b.classList.contains("choisi") && b.offsetWidth);
  const indic = $("#indicateur");
  if (!choisi) return;
  if (large) {
    indic.style.width = "";
    indic.style.transform = `translateY(${choisi.offsetTop}px)`;
  } else {
    indic.style.width = `${choisi.offsetWidth}px`;
    indic.style.transform = `translateX(${choisi.offsetLeft}px)`;
  }
}

function marquerNav(id) {
  const large = matchMedia("(min-width: 740px)").matches;
  for (const b of document.querySelectorAll(".nav-btn")) {
    const dansPlus = b.classList.contains("plus") && !large && !!(PAGES[id] && PAGES[id].secondaire); // un vrai booléen : toggle(x, undefined) inverserait
    b.classList.toggle("choisi", b.dataset.page === id || dansPlus);
  }
  placerIndicateur();
}

function aller(id) {
  vibrer();
  fermerFeuille();
  if (location.hash === `#${id}`) afficher({ dy: "8px" });
  else location.hash = id;
}

function ouvrirPlus() {
  vibrer();
  const boutons = ORDRE.filter((id) => PAGES[id].secondaire).map((id) => el("button", { class: "btn", type: "button", onclick: () => aller(id) }, icone(I[id]), PAGES[id].titre));
  ouvrirFeuille([
    el("h2", {}, "Plus"),
    el("div", { class: "menu-plus" }, boutons, PC ? el("button", { class: "btn fort", type: "button", onclick: lireCarte }, icone(I.ajout), "Lire ma carte") : null,
      el("button", { class: `btn${PC ? "" : " fort"}`, type: "button", onclick: () => { fermerFeuille(); choisirFichier(); } }, icone(I.ajout), "Ajouter un fichier")),
  ]);
}

let jetonRendu = 0;
let compteRendu = 0;

async function afficher(direction) {
  const id = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : "accueil";
  const nouvellePage = id !== routeActuelle;
  routeActuelle = id;
  marquerNav(id);
  const jeton = ++jetonRendu;
  const page = $("#page");
  let contenu;
  try {
    contenu = await PAGES[id].rendre();
  } catch (e) {
    contenu = [el("div", { class: "message rouge" }, `Cette page n'a pas pu s'afficher : ${e.message}`)];
  }
  if (jeton !== jetonRendu) return;
  page.replaceChildren(...[contenu].flat(Infinity).filter(Boolean));
  compteRendu++;
  if (direction) {
    page.style.setProperty("--dx", direction.dx || "0");
    page.style.setProperty("--dy", direction.dy || "0");
    page.classList.remove("entree");
    void page.offsetWidth;
    page.classList.add("entree");
    if (nouvellePage) scrollTo(0, 0);
  }
}

// Après une saisie : même page, sans rejouer les animations
async function rafraichir() {
  animer = false;
  await relireEtat(true);
  await afficher(null);
  animer = true;
}

// ------------------------------------------------------------ choix du mois
function bornesMois() {
  const liste = etat.mois_disponibles || [];
  if (!liste.length) return null;
  const v = liste.map(([a, m]) => a * 12 + m - 1);
  return { min: Math.min(...v), max: Math.max(...v) };
}

function changerMois(delta) {
  const b = bornesMois();
  if (!b || !M) return;
  const v = M.a * 12 + M.m - 1 + delta;
  if (v < b.min || v > b.max) return;
  vibrer();
  M = { a: Math.floor(v / 12), m: (v % 12) + 1 };
  afficher({ dx: delta > 0 ? "28px" : "-28px" });
}

function choixMois() {
  const b = bornesMois();
  const v = M.a * 12 + M.m - 1;
  return el("div", { class: "mois-choix" },
    el("button", { type: "button", "aria-label": "Mois d'avant", disabled: !b || v <= b.min, onclick: () => changerMois(-1) }, "‹"),
    el("span", {}, `${NOMS_MOIS[M.m - 1]} ${M.a}`),
    el("button", { type: "button", "aria-label": "Mois d'après", disabled: !b || v >= b.max, onclick: () => changerMois(1) }, "›"));
}

function entete(titre, sous, avecMois) {
  return el("header", { class: "entete" },
    el("div", {}, el("h1", {}, titre), sous ? el("p", { class: "doux petit" }, sous) : null),
    avecMois && M ? choixMois() : null);
}

function sansCarte(titre) {
  return [entete(titre), el("div", { class: "carte accueil-vide" }, el("p", { class: "doux" }, "Rien à montrer pour l'instant : ajoute le fichier de ta carte, ou essaie la démo."),
    el("div", { class: "boutons" }, boutonCarte(), el("button", { class: `btn${PC ? "" : " fort"}`, type: "button", onclick: choisirFichier }, "Ajouter le fichier de ma carte"), el("button", { class: "btn", type: "button", onclick: entrerDemo }, "Essayer avec une carte de démo")))];
}

// Glisser à gauche ou à droite change de mois
function activerBalayage() {
  let x = 0;
  let y = 0;
  let actif = false;
  const page = $("#page");
  page.addEventListener("touchstart", (e) => {
    actif = e.touches.length === 1 && !e.target.closest(".puces, .barres, input, select, textarea");
    x = e.touches[0].clientX;
    y = e.touches[0].clientY;
  }, { passive: true });
  page.addEventListener("touchend", (e) => {
    if (!actif || !["mois", "semaines", "jours", "infractions", "paie"].includes(routeActuelle)) return;
    const dx = e.changedTouches[0].clientX - x;
    const dy = e.changedTouches[0].clientY - y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) changerMois(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ------------------------------------------------------------ morceaux réutilisés
function tuile(libelle, valeur, sous, genre) {
  return el("div", { class: `tuile ${genre || ""}` }, el("div", { class: "libelle" }, libelle), el("div", { class: "valeur" }, valeur), sous ? el("div", { class: "sous" }, sous) : null);
}

function jauge(c) {
  const genre = c.ratio >= 1 ? "fort" : c.ratio >= 0.8 ? "moyen" : "";
  const rempli = el("div", { class: "rempli" });
  monter(rempli, "width", `${Math.min(100, c.ratio * 100)}%`);
  return el("div", { class: `jauge ${genre}` },
    el("div", { class: "haut" }, el("span", {}, c.libelle), el("span", { class: "doux" }, `${duree(c.minutes)} sur ${Math.round(c.seuil / 60)} h · ${c.restant > 0 ? `reste ${duree(c.restant)}` : "limite atteinte"}`)),
    el("div", { class: "rail" }, rempli));
}

const NOMS_ACTIVITES = ["Repos / pause", "Disponibilité", "Travail", "Conduite"];

function frise(f) {
  const n = el("div", { class: `frise${animationsActives() ? " entre" : ""}`, role: "img", "aria-label": "Activités de la journée" });
  for (const [debut, fin, activite, carte] of f.tranches) {
    n.append(el("div", {
      class: `morceau a${activite}${carte ? "" : " sans"}`,
      style: `left:${(debut / f.total) * 100}%;width:${((fin - debut) / f.total) * 100}%`,
      title: `${NOMS_ACTIVITES[activite]} : ${duree(fin - debut)}`,
    }));
  }
  return el("div", {}, n, el("div", { class: "heures-frise" }, ["0 h", "6 h", "12 h", "18 h", "24 h"].map((h) => el("span", {}, h))));
}

function legende() {
  const point = (couleur, texte) => el("span", {}, el("i", { style: `background:var(--${couleur})` }), texte);
  return el("div", { class: "legende" }, point("conduite", "Conduite"), point("travail", "Travail"), point("dispo", "Dispo"), point("repos", "Repos"), point("repos-sans", "Carte retirée (pâle)"));
}

function barres(liste, avecRepere) {
  const ech = Math.max(14 * 60, ...liste.map((b) => b.conduite + b.travail + b.dispo));
  const hauteur = (m) => `${(m / ech) * 100}%`;
  const n = el("div", { class: `barres${liste.length > 10 ? " long" : ""}` });
  for (const b of liste) {
    const total = b.conduite + b.travail + b.dispo;
    const pile = el("div", { class: "pile" },
      b.conduite ? el("div", { class: "c", style: `flex:${b.conduite} 0 0` }) : null,
      b.travail ? el("div", { class: "t", style: `flex:${b.travail} 0 0` }) : null,
      b.dispo ? el("div", { class: "d", style: `flex:${b.dispo} 0 0` }) : null);
    monter(pile, "height", `calc(${hauteur(total)} - ${total ? 0 : 0}px)`);
    n.append(el("button", { type: "button", class: "barre", "aria-label": `${b.nom} : ${duree(total)}`, onclick: () => ouvrirJour(b.iso) }, pile, el("span", { class: "nom" }, b.nom)));
  }
  if (avecRepere) n.append(el("div", { class: "repere", style: `bottom:calc(20px + (100% - 20px) * ${540 / ech})` }, el("span", {}, "9 h de conduite")));
  // Sur petit écran, la frise défile : on la place sur les derniers jours remplis.
  const remplis = liste.reduce((i, b, k) => (b.conduite + b.travail + b.dispo ? k : i), -1);
  if (liste.length > 10 && remplis >= 0) {
    setTimeout(() => {
      const b = n.querySelectorAll(".barre")[remplis];
      if (b) n.scrollLeft = b.offsetLeft + b.offsetWidth + 16 - n.clientWidth;
    }, 80);
  }
  return n;
}

const PETITE_LEGENDE = () => el("div", { class: "legende" }, el("span", {}, el("i", { style: "background:var(--conduite)" }), "Conduite"), el("span", {}, el("i", { style: "background:var(--travail)" }), "Travail"), el("span", {}, el("i", { style: "background:var(--dispo)" }), "Dispo"));

// ------------------------------------------------------------ accueil
async function pageAccueil() {
  const a = await q("accueil");
  if (!a.carte) return accueilVide();
  const rappels = a.rappels.slice(0, 6).map((r) => el("button", { type: "button", class: "ligne-btn rappel", onclick: () => aller(r.page) }, el("span", { class: `point ${r.gravite}` }), el("span", { class: "milieu" }, r.texte), el("span", { class: "suite" }, "›")));
  const copie = rappelCopie();
  return [
    entete(`Bonjour, ${a.prenom || "chauffeur"}`, a.lu ? `Dernière lecture de la carte : le ${a.lu}` : ""),
    el("div", { class: "tuiles" },
      tuile(`Conduite, ${a.ref_court}`, chiffre(a.jour.conduite, duree), `amplitude ${duree(a.jour.amplitude)}`, "vif"),
      tuile("Conduite de la semaine", chiffre(a.semaine.conduite, duree), `service ${duree(a.semaine.service)}`),
      tuile(`Km en ${a.mois.titre.split(" ")[0].toLowerCase()}`, chiffre(a.mois.km, (v) => nombre(Math.round(v))), accorder(a.mois.jours_travailles, "jour travaillé", "jours travaillés")),
      a.net === null ? tuile("Net simulé", "—", "pas encore d'heures payées ce mois-ci", "rien") : tuile("Net simulé", chiffre(a.net, euros), "indicatif, pas un bulletin")),
    el("div", { class: "grille-2" },
      el("section", { class: "carte" }, el("h2", {}, "À regarder"), rappels.length || copie ? el("div", {}, rappels, copie) : el("div", { class: "message vert" }, "✔ Rien à signaler.")),
      el("section", { class: "carte" }, el("h2", {}, "Où tu en es"), a.compteurs.map(jauge))),
    el("section", { class: "carte" },
      el("h2", {}, `Dernier jour travaillé : ${a.ref_court}`, el("button", { type: "button", class: "lien", onclick: () => ouvrirJour(a.ref) }, "Voir ce jour")),
      frise(a.frise), legende(),
      el("p", { class: "doux petit" }, `Conduite ${duree(a.jour.conduite)} · travail ${duree(a.jour.travail)} · dispo ${duree(a.jour.dispo)} · ${nombre(a.jour.km)} km`)),
    el("section", { class: "carte" }, el("h2", {}, a.semaine.titre), barres(a.barres, true), PETITE_LEGENDE()),
    el("div", { class: "boutons" }, boutonCarte(), el("button", { class: `btn${PC ? "" : " fort"}`, type: "button", onclick: choisirFichier }, "Ajouter le fichier de ma carte")),
    el("p", { class: "doux petit", style: "text-align:center" }, "La carte n'est jamais modifiée : TachoReader ne fait que lire le fichier."),
  ];
}

function joursDepuis(instant) {
  return Math.floor((Date.now() / 1000 - instant) / 86400);
}

function rappelCopie() {
  if (demo) return null;
  const quand = etat.derniere_copie;
  if (quand && joursDepuis(quand) < 30) return null;
  return el("button", { type: "button", class: "ligne-btn rappel", onclick: () => aller("reglages") }, el("span", { class: "point" }),
    el("span", { class: "milieu" }, quand ? `Dernière copie il y a ${joursDepuis(quand)} jours : pense à en refaire une.` : "Aucune copie encore : tes données ne sont que sur cet appareil."), el("span", { class: "suite" }, "›"));
}

function accueilVide() {
  return [
    el("div", { class: "carte accueil-vide" },
      el("img", { src: "icone-192.png", alt: "", width: 84, height: 84 }),
      el("h1", {}, "Bienvenue"),
      el("p", {}, PC ? "Mets ta carte conducteur dans le lecteur, ou donne-moi son fichier (.ddd) : tes heures, tes infractions et ta paie indicative s'affichent tout de suite."
        : "Donne-moi le fichier de ta carte conducteur (.ddd) : tes heures, tes infractions et ta paie indicative s'affichent tout de suite."),
      el("div", { class: "boutons" }, boutonCarte(), el("button", { class: `btn${PC ? "" : " fort"}`, type: "button", onclick: choisirFichier }, "Ajouter le fichier de ma carte"), el("button", { class: "btn", type: "button", onclick: entrerDemo }, "Essayer avec une carte de démo"), el("button", { class: "btn", type: "button", onclick: () => aller("reglages") }, "Reprendre une copie")),
      el("p", { class: "doux petit" }, "Le fichier vient d'une application de lecture de carte, du tachygraphe de ton employeur, ou de TachoReader sur PC. Rien ne quitte cet appareil.")),
    aideInstallation(),
  ];
}

// ------------------------------------------------------------ mois
const MARQUE_VIDE = "";

function caseJour(c, i, aujourdhui) {
  const couleur = c.statut === "avant" ? "avant" : c.couleur;
  const total = c.conduite + c.travail + c.dispo;
  const marques = [c.infraction ? "⚠" : "", c.decouche ? "🌙" : "", c.note ? "✎" : ""].join("") || MARQUE_VIDE;
  let temps = "";
  if (c.statut === "absence") temps = c.ferie ? "férié" : "absent";
  else if (total) temps = duree(total);
  else if (c.ferie) temps = "férié";
  return el("button", {
    type: "button",
    class: `jour-case ${couleur}${c.iso === aujourdhui ? " aujourdhui" : ""}${animationsActives() ? " entre" : ""}`,
    style: `--i:${i}`,
    "aria-label": `${c.court} : ${c.etat}${total ? `, ${duree(total)}` : ""}`,
    onclick: () => ouvrirJour(c.iso),
  }, el("span", { class: `num${c.ferie || c.dimanche ? " rouge" : ""}` }, c.num, el("span", { class: "marques" }, marques)),
  el("span", { class: "temps" }, temps),
  total ? el("span", { class: "mini", style: `width:${Math.min(100, (total / 840) * 100)}%` }) : null);
}

function resumeMois(d) {
  const t = d.totaux;
  const n = [];
  if (t.en_cours) n.push("Mois en cours : les chiffres vont encore changer.");
  else if (t.complet) n.push("✔ Mois complet.");
  if (t.manquants) n.push(`${accorder(t.manquants, "jour", "jours")} sans données et sans absence : pense à relire la carte ou à poser une absence.`);
  if (t.avant_carte) n.push(`${accorder(t.avant_carte, "jour", "jours")} avant la première donnée de la carte : le mois n'est pas entier.`);
  if (t.incomplets) n.push(`${accorder(t.incomplets, "jour incomplet", "jours incomplets")} (la carte a été lue pendant la journée).`);
  if (d.nb_graves) n.push(`⚠ ${accorder(d.nb_graves, "infraction", "infractions")} : voir la page Infractions.`);
  if (d.nb_avert) n.push(`${accorder(d.nb_avert, "avertissement", "avertissements")}.`);
  return n.length ? n : ["Rien à signaler."];
}

function ecart(actuel, avant) {
  if (!avant) return "";
  const d = actuel - avant;
  return d ? `${d > 0 ? "+" : "−"}${duree(Math.abs(d))} / mois d'avant` : "comme le mois d'avant";
}

async function pageMois() {
  if (!M) return sansCarte("Mois");
  const d = await q("mois", [M.a, M.m]);
  const t = d.totaux;
  const p = d.precedent;
  const vides = Array.from({ length: d.decalage }, () => el("div", { class: "vide-case" }));
  return [
    entete("Mois", "", true),
    el("div", { class: "tuiles" },
      tuile("Conduite", chiffre(t.conduite, duree), ecart(t.conduite, p.conduite), "vif"),
      tuile("Travail", chiffre(t.travail, duree), ecart(t.travail, p.travail)),
      tuile("Service", chiffre(t.service, duree), ecart(t.service, p.service)),
      tuile("Nuit", chiffre(t.nuit, duree)),
      tuile("Km", chiffre(t.km, (v) => nombre(Math.round(v)))),
      tuile("Jours travaillés", chiffre(t.jours_travailles, (v) => String(Math.round(v))), `sur ${t.nb_jours} jours`)),
    el("section", { class: "carte" },
      el("div", { class: "semaine-noms" }, ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].map((j) => el("div", {}, j))),
      el("div", { class: "calendrier" }, vides, d.jours.map((c, i) => caseJour(c, i, d.aujourdhui))),
      el("div", { class: "legende" }, [["vert", "Complet"], ["jaune", "Incomplet"], ["orange", "Manquant"], ["gris", "Absence"]].map(([c, n]) => el("span", {}, el("i", { style: `background:var(--${c})` }), n)))),
    el("section", { class: "carte" }, el("h2", {}, "En résumé"), resumeMois(d).map((l) => el("p", { class: "petit" }, l))),
    el("section", { class: "carte" }, el("h2", {}, "Jour par jour"),
      barres(d.jours.map((c) => ({ nom: String(c.num), iso: c.iso, conduite: c.conduite, travail: c.travail, dispo: c.dispo })), true), PETITE_LEGENDE()),
  ];
}

// ------------------------------------------------------------ semaines
async function pageSemaines() {
  if (!M) return sansCarte("Semaines");
  const d = await q("semaines", [M.a, M.m]);
  return [
    entete("Semaines", "", true),
    d.semaines.map((s) => el("section", { class: "carte" },
      el("h2", {}, s.titre, el("span", { class: `etiquette ${s.etat === "complète" ? "vert" : s.etat === "en cours" ? "" : "orange"}` }, s.etat)),
      el("p", { class: "doux petit" }, `Du ${s.du} au ${s.au}${s.infractions ? ` · ⚠ ${accorder(s.infractions, "infraction", "infractions")}` : ""}`),
      el("div", { class: "tuiles" },
        tuile("Conduite", duree(s.conduite), "", "vif"), tuile("Travail", duree(s.travail)), tuile("Dispo", duree(s.dispo)), tuile("Service", duree(s.service)), tuile("Nuit", duree(s.nuit)), tuile("Km", nombre(s.km), accorder(s.jours_travailles, "jour travaillé", "jours travaillés"))),
      barres(s.barres, true))),
    PETITE_LEGENDE(),
  ];
}

// ------------------------------------------------------------ jours
const FILTRES_JOURS = [
  ["tous", "Tous les jours", () => true],
  ["travailles", "Travaillés", (j) => j.statut === "donnees"],
  ["sans", "Sans données", (j) => j.statut === "sans"],
  ["incomplets", "Incomplets", (j) => j.statut === "donnees" && j.etat === "incomplet"],
  ["absences", "Absences", (j) => j.statut === "absence"],
  ["dimanches", "Dimanches et fériés", (j) => j.dimanche || j.ferie],
  ["infraction", "Avec infraction", (j) => j.nb_infractions > 0],
];
let filtreJours = "tous";

async function pageJours() {
  if (!M) return sansCarte("Jours");
  const d = await q("liste_jours", [M.a, M.m]);
  const filtre = FILTRES_JOURS.find((f) => f[0] === filtreJours)[2];
  const garde = d.jours.filter(filtre);
  return [
    entete("Jours", "", true),
    el("div", { class: "puces" }, FILTRES_JOURS.map(([id, nom]) => el("button", { type: "button", class: `puce${id === filtreJours ? " choisie" : ""}`, onclick: () => { filtreJours = id; afficher({ dy: "4px" }); } }, nom))),
    el("section", { class: "carte" }, garde.length ? garde.map((j) => el("button", { type: "button", class: "ligne-btn", onclick: () => ouvrirJour(j.iso) },
      el("span", { class: "milieu" }, el("strong", {}, j.court), " ", el("span", { class: `etiquette ${j.couleur}` }, j.etat), j.nb_infractions ? el("span", {}, " ⚠") : null, j.decouche ? " 🌙" : null, j.note ? " ✎" : null,
        j.debut ? el("div", { class: "doux petit" }, `${j.debut} → ${j.fin}${j.km ? ` · ${nombre(j.km)} km` : ""}`) : null),
      el("span", { class: "droite" }, duree(j.conduite + j.travail + j.dispo)), el("span", { class: "suite" }, "›"))) : el("p", { class: "doux" }, "Aucun jour pour ce filtre.")),
  ];
}

async function ouvrirJour(iso) {
  vibrer();
  ouvrirFeuille(await contenuJour(iso));
}

async function contenuJour(iso) {
  const j = await q("jour", [iso]);
  const total = j.conduite + j.travail + j.dispo;
  const recharger = async (texte) => {
    toast(texte);
    await rafraichir();
    remplirFeuille(await contenuJour(iso));
  };
  const typeAbsence = el("select", { id: "absence-type", "aria-label": "Type d'absence" }, j.types_absence.map(([c, n]) => el("option", { value: c, selected: j.absence && j.absence.type === c }, n)));
  const comAbsence = el("input", { type: "text", "aria-label": "Commentaire de l'absence", placeholder: "Commentaire (facultatif)", value: j.absence ? j.absence.commentaire || "" : "" });
  const note = el("textarea", { "aria-label": "Note du jour", placeholder: "Une note pour ce jour…" }, j.note);
  const decouche = el("input", { type: "checkbox", checked: j.decouche, "aria-label": "Découché", onchange: async () => { await q("poser_decouche", [iso, decouche.checked]); await recharger(decouche.checked ? "Découché noté." : "Découché retiré."); } });
  return [
    el("h2", {}, j.titre, " ", el("span", { class: `etiquette ${j.couleur}` }, j.etat)),
    j.ferie ? el("p", { class: "doux" }, `Férié : ${j.ferie}`) : null,
    j.frise.tranches.length ? el("div", {}, frise(j.frise)) : null,
    j.frise.tranches.length ? legende() : null,
    total ? el("div", { class: "tuiles" }, tuile("Conduite", duree(j.conduite), "", "vif"), tuile("Travail", duree(j.travail)), tuile("Dispo", duree(j.dispo)), tuile("Nuit", duree(j.nuit)), tuile("Km", nombre(j.km)), tuile("Amplitude", duree(j.amplitude))) : null,
    j.postes.map((s) => el("p", { class: "petit" }, `Poste ${s.debut} → ${s.fin} : amplitude ${duree(s.amplitude)}, ${accorder(s.pauses, "pause", "pauses")}, plus longue conduite sans pause ${duree(s.continue_max)}.`)),
    j.vehicules.length ? el("p", { class: "doux petit" }, `Véhicule : ${j.vehicules.join(", ")}`) : null,
    j.absence ? el("div", { class: "message" }, `Absence : ${j.absence.nom}${j.absence.commentaire ? ` (${j.absence.commentaire})` : ""}`) : null,
    !total && !j.absence && j.statut === "sans" ? el("p", { class: "doux" }, "Rien d'enregistré pour ce jour.") : null,
    j.infractions.map((i) => el("button", { type: "button", class: "message rouge", style: "border:0;text-align:left", onclick: () => ouvrirInfraction(i) }, `⚠ ${i.regle} : ${i.explication}`)),
    j.possible ? [
      el("section", { class: "carte" }, el("h2", {}, "Absence"), el("div", { class: "pile-champ" }, typeAbsence, comAbsence),
        el("div", { class: "boutons" }, el("button", { class: "btn", type: "button", onclick: async () => { await q("poser_absence", [iso, typeAbsence.value, comAbsence.value]); await recharger("Absence enregistrée."); } }, j.absence ? "Modifier l'absence" : "Poser l'absence"),
          j.absence ? el("button", { class: "btn danger", type: "button", onclick: async () => { await q("poser_absence", [iso, null]); await recharger("Absence retirée."); } }, "Retirer") : null)),
      el("section", { class: "carte" }, el("h2", {}, "Note"), note, el("button", { class: "btn", type: "button", onclick: async () => { await q("poser_note", [iso, note.value]); await recharger("Note enregistrée."); } }, "Enregistrer la note"),
        el("div", { class: "champ" }, el("label", {}, "Découché (nuit hors de chez toi)"), el("span", { class: "interrupteur" }, decouche, el("i")))),
    ] : null,
  ];
}

// ------------------------------------------------------------ infractions
const FILTRES_INF = [
  ["toutes", "Toutes", () => true],
  ["graves", "Graves et au-dessus", (i) => i.rang >= 2],
  ["mineures", "Mineures", (i) => i.gravite === "MI"],
  ["avert", "Avertissements", (i) => i.gravite === "AV"],
  ["nonvues", "Pas encore vues", (i) => !i.vue],
];
let filtreInf = "toutes";
const COULEUR_GRAVITE = { AV: "", MI: "jaune", SI: "orange", VSI: "rouge", MSI: "rouge" };

async function pageInfractions() {
  if (!M) return sansCarte("Infractions");
  const d = await q("infractions", [M.a, M.m]);
  const s = d.synthese;
  const garde = d.liste.filter(FILTRES_INF.find((f) => f[0] === filtreInf)[2]);
  const nbTres = s.VSI + s.MSI;
  return [
    entete("Infractions", "Calcul indicatif à partir de la carte : seul un contrôle officiel fait foi.", true),
    el("div", { class: "tuiles" },
      tuile("Très graves", chiffre(nbTres, (v) => String(Math.round(v))), "", nbTres ? "alerte" : "rien"),
      tuile("Graves", chiffre(s.SI, (v) => String(Math.round(v))), "", s.SI ? "alerte" : "rien"),
      tuile("Mineures", chiffre(s.MI, (v) => String(Math.round(v))), "", s.MI ? "" : "rien"),
      tuile("Avertissements", chiffre(s.AV, (v) => String(Math.round(v))), "", s.AV ? "" : "rien"),
      tuile("Événements de la carte", chiffre(d.evenements.length, (v) => String(Math.round(v))), "", d.evenements.length ? "" : "rien")),
    el("div", { class: "puces" }, FILTRES_INF.map(([id, nom]) => el("button", { type: "button", class: `puce${id === filtreInf ? " choisie" : ""}`, onclick: () => { filtreInf = id; afficher({ dy: "4px" }); } }, nom))),
    el("section", { class: "carte" }, garde.length ? garde.map((i) => el("button", { type: "button", class: "ligne-btn", onclick: () => ouvrirInfraction(i) },
      el("span", { class: "milieu" }, el("strong", {}, i.regle), " ", el("span", { class: `etiquette ${COULEUR_GRAVITE[i.gravite]}` }, i.nom_gravite),
        el("div", { class: "doux petit" }, `${i.court} · ${i.vue ? `Vue${i.commentaire ? ` : ${i.commentaire}` : ""}` : "À regarder"}`)),
      el("span", { class: "suite" }, "›"))) : el("div", { class: "message vert" }, d.liste.length ? "Rien pour ce filtre." : "✔ Aucune infraction ce mois-ci.")),
    d.evenements.length ? el("section", { class: "carte" }, el("h2", {}, "Événements de la carte"), d.evenements.map((e) => el("div", { class: "bul-ligne" }, el("span", {}, e.type, el("div", { class: "doux petit" }, e.vehicule || "")), el("span", { class: "doux petit" }, `${e.date} ${e.heure}`)))) : null,
  ];
}

function ouvrirInfraction(i) {
  vibrer();
  const com = el("input", { type: "text", "aria-label": "Commentaire", placeholder: "Par exemple : dérogation art. 12, bouchon A7", value: i.commentaire });
  ouvrirFeuille([
    el("h2", {}, i.regle),
    el("p", {}, el("span", { class: `etiquette ${COULEUR_GRAVITE[i.gravite]}` }, i.nom_gravite), el("span", { class: "doux petit" }, ` ${i.court} · ${i.reference}`)),
    el("p", {}, i.explication),
    el("div", { class: "message" }, `Pour l'éviter : ${i.eviter}`),
    el("section", { class: "carte" }, el("h2", {}, i.vue ? "Vue" : "À regarder"), el("div", { class: "pile-champ" }, com),
      el("div", { class: "boutons" },
        el("button", { class: "btn fort", type: "button", onclick: async () => { await q("acquitter", [i.cle, com.value]); fermerFeuille(); toast("Marquée comme vue."); await rafraichir(); } }, i.vue ? "Enregistrer" : "Marquer comme vue"),
        i.vue ? el("button", { class: "btn", type: "button", onclick: async () => { await q("acquitter", [i.cle, null]); fermerFeuille(); await rafraichir(); } }, "Remettre à regarder") : null)),
    el("button", { class: "btn", type: "button", onclick: () => ouvrirJour(i.jour) }, "Voir le jour"),
  ]);
}

// ------------------------------------------------------------ paie
function ligneBulletin(libelle, montant, trace, genre) {
  return el("div", { class: `bul-ligne ${genre || ""}` }, el("span", {}, libelle), el("span", { class: "montant" }, montant), trace ? el("span", { class: "trace" }, trace) : null);
}

async function pagePaie() {
  if (!M) return sansCarte("Paie");
  const r = await q("paie", [M.a, M.m]);
  const paniers = r.paniers.filter((p) => p.type !== "aucun" || p.saisi);
  return [
    entete("Paie", "", true),
    el("div", { class: "message jaune" }, r.avertissement),
    el("div", { class: "tuiles" },
      tuile("Brut simulé", chiffre(r.brut, euros), r.payees ? `${duree(r.payees)} payées` : "aucune heure payée"),
      tuile("Cotisations + mutuelle", chiffre(r.cotisations_total + r.mutuelle, euros)),
      tuile("Paniers", chiffre(r.paniers_total, euros), accorder(paniers.filter((p) => p.montant).length, "jour avec panier", "jours avec panier")),
      tuile("Net simulé", chiffre(r.net, euros), r.impot ? `après impôt : ${euros(r.net_apres_impot)}` : "avant impôt à la source", "vif")),
    r.notes.length ? el("div", { class: "message orange" }, r.notes.map((n) => el("div", {}, n))) : null,
    el("section", { class: "carte" }, el("h2", {}, "Le calcul, ligne par ligne"), el("div", { class: "bulletin" },
      r.lignes.map((l) => ligneBulletin(`${l.libelle}${l.quantite ? ` (${l.quantite}${l.taux ? ` · ${l.taux}` : ""})` : ""}`, euros(l.montant), l.trace)),
      ligneBulletin("Brut", euros(r.brut), "Somme des lignes au-dessus.", "total"),
      r.cotisations.map((l) => ligneBulletin(`${l.libelle}${l.quantite ? ` (${l.quantite})` : ""}`, `− ${euros(l.montant)}`, l.trace)),
      ligneBulletin("Mutuelle", `− ${euros(r.mutuelle)}`, "Montant fixe des paramètres."),
      ligneBulletin("Paniers", `+ ${euros(r.paniers_total)}`, "Frais non soumis aux cotisations."),
      ligneBulletin("Net simulé", euros(r.net), r.avertissement, "total net"),
      r.impot ? ligneBulletin("Impôt à la source", `− ${euros(r.impot)}`, "Sur le net imposable, hors paniers.") : null,
      r.impot ? ligneBulletin("Net après impôt", euros(r.net_apres_impot), "", "total") : null)),
    el("section", { class: "carte" }, el("h2", {}, "Les heures, semaine par semaine"), r.semaines.map((s) => el("div", { class: "bul-ligne" },
      el("span", {}, s.titre, el("div", { class: "doux petit" }, `Normales ${duree(s.normales)} · sup. ${duree(s.hs1)} + ${duree(s.hs2)}${s.note ? ` · ${s.note}` : ""}`)), el("span", { class: "montant" }, duree(s.service)))),
    el("p", { class: "doux petit" }, "Une semaine compte pour le mois de son dimanche, sauf réglage contraire.")),
    el("section", { class: "carte" }, el("h2", {}, "Paniers"), r.paniers.length ? r.paniers.map((p) => el("button", { type: "button", class: "ligne-btn", onclick: () => ouvrirPanier(p, r.types_panier) },
      el("span", { class: "milieu" }, el("strong", {}, p.court), " ", p.nom, p.saisi ? el("span", { class: "etiquette", style: "margin-left:6px" }, "corrigé") : null, el("div", { class: "doux petit" }, `${p.debut} → ${p.fin} · ${duree(p.amplitude)}`)),
      el("span", { class: "droite" }, p.montant ? euros(p.montant) : "—"), el("span", { class: "suite" }, "›"))) : el("p", { class: "doux" }, "Aucun jour travaillé ce mois-ci.")),
    el("div", { class: "boutons" }, el("button", { class: "btn fort", type: "button", onclick: ouvrirDocuments }, "Documents du mois")),
  ];
}

function ouvrirPanier(p, types) {
  vibrer();
  const montant = el("input", { type: "text", inputmode: "decimal", "aria-label": "Montant", placeholder: "Montant, par exemple 12,50", value: p.type === "libre" ? String(p.montant).replace(".", ",") : "" });
  const ligneMontant = el("div", { class: "pile-champ", hidden: p.type !== "libre" }, montant);
  const type = el("select", { "aria-label": "Type de panier", onchange: () => { ligneMontant.hidden = type.value !== "libre"; } }, types.map(([c, n]) => el("option", { value: c, selected: c === p.type }, n)));
  const com = el("input", { type: "text", "aria-label": "Commentaire", placeholder: "Commentaire (facultatif)", value: p.commentaire || "" });
  ouvrirFeuille([
    el("h2", {}, `Panier du ${p.court}`),
    el("p", { class: "doux petit" }, `Proposition : ${p.auto}. ${p.regle}.`),
    el("div", { class: "pile-champ" }, type, ligneMontant, com),
    el("div", { class: "boutons" },
      el("button", { class: "btn fort", type: "button", onclick: async () => {
        const r = await q("poser_panier", [p.iso, type.value, montant.value, com.value]);
        if (!r.ok) return toast(r.message, { erreur: true });
        fermerFeuille();
        toast("Panier enregistré.");
        return rafraichir();
      } }, "Enregistrer"),
      p.saisi ? el("button", { class: "btn", type: "button", onclick: async () => { await q("retirer_panier", [p.iso]); fermerFeuille(); toast("Retour à l'automatique."); await rafraichir(); } }, "Revenir à l'automatique") : null),
  ]);
}

// ------------------------------------------------------------ documents et partage
const TYPES = { html: "text/html", csv: "text/csv", zip: "application/zip", ddd: "application/octet-stream", json: "application/json" };

function typeDe(nom) {
  return TYPES[nom.split(".").pop().toLowerCase()] || "application/octet-stream";
}

// Doit partir directement d'un appui : Safari refuse un partage qui n'en vient pas
async function envoyer(nom, octets) {
  const fichier = new File([octets], nom, { type: typeDe(nom) });
  const tactile = matchMedia("(pointer: coarse)").matches;
  if (tactile && navigator.canShare && navigator.canShare({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier] });
      return true;
    } catch (e) {
      if (e.name === "AbortError") return false;
    }
  }
  const adresse = URL.createObjectURL(fichier);
  const a = el("a", { href: adresse, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 60000);
  return true;
}

async function ouvrirDocuments() {
  vibrer();
  ouvrirFeuille([el("h2", {}, "Documents du mois"), el("p", { class: "doux" }, "Préparation…")]);
  const r = await q("documents", [M.a, M.m]);
  const pages = r.documents.filter((d) => d.nom.endsWith(".html"));
  const csv = r.documents.filter((d) => d.nom.endsWith(".csv"));
  remplirFeuille([
    el("h2", {}, `Documents, ${NOMS_MOIS[M.m - 1].toLowerCase()} ${M.a}`),
    el("p", { class: "doux petit" }, "Ouvre-les ici, ou envoie-les à toi-même. La paie reste une simulation indicative."),
    pages.map((d) => el("button", { type: "button", class: "ligne-btn", onclick: () => voirDocument(d) }, el("span", { class: "milieu" }, d.nom.replace(".html", "")), el("span", { class: "suite" }, "Voir ›"))),
    el("h3", {}, "Pour un tableur (CSV)"),
    csv.map((d) => el("button", { type: "button", class: "ligne-btn", onclick: () => envoyer(d.nom, d.octets) }, el("span", { class: "milieu" }, d.nom), el("span", { class: "suite" }, "Envoyer ›"))),
  ]);
}

function voirDocument(d) {
  const html = new TextDecoder().decode(d.octets);
  remplirFeuille([
    el("h2", {}, d.nom.replace(".html", "")),
    el("iframe", { class: "visionneuse", sandbox: "", srcdoc: html, title: d.nom }),
    el("button", { class: "btn fort", type: "button", onclick: () => envoyer(d.nom, d.octets) }, "Envoyer / enregistrer"),
  ]);
  $("#feuille").classList.add("plein");
}

// ------------------------------------------------------------ année
let anneeChoisie = null;

async function pageAnnee() {
  const d = await q("annee", [anneeChoisie]);
  if (!d.annee) return sansCarte("Année");
  const ech = Math.max(1, ...d.mois.map((m) => m.service));
  const total = d.mois.reduce((s, m) => ({ service: s.service + m.service, conduite: s.conduite + m.conduite, km: s.km + m.km, jours: s.jours + m.jours, infractions: s.infractions + m.infractions, net: s.net + m.net }), { service: 0, conduite: 0, km: 0, jours: 0, infractions: 0, net: 0 });
  return [
    entete("Année", "Le bilan, mois par mois."),
    el("div", { class: "puces" }, d.annees.map((a) => el("button", { type: "button", class: `puce${a === d.annee ? " choisie" : ""}`, onclick: () => { anneeChoisie = a; afficher({ dy: "4px" }); } }, String(a)))),
    el("div", { class: "tuiles" },
      tuile("Conduite", chiffre(total.conduite, duree), "", "vif"),
      tuile("Service", chiffre(total.service, duree)),
      tuile("Km", chiffre(total.km, (v) => nombre(Math.round(v)))),
      tuile("Jours travaillés", chiffre(total.jours, (v) => String(Math.round(v)))),
      tuile("Infractions", chiffre(total.infractions, (v) => String(Math.round(v))), "", total.infractions ? "alerte" : "rien"),
      tuile("Net simulé", chiffre(total.net, euros), "indicatif, pas un bulletin")),
    el("section", { class: "carte" }, el("h2", {}, String(d.annee)), d.mois.map((m) => {
      const rempli = el("div", { class: "rempli" });
      monter(rempli, "width", `${(m.service / ech) * 100}%`);
      return el("button", { type: "button", class: "ligne-btn", onclick: () => { M = { a: d.annee, m: m.mois }; aller("mois"); } },
        el("span", { class: "milieu jauge" }, el("div", { class: "haut" }, el("strong", {}, m.nom), el("span", { class: "doux" }, `${duree(m.service)} · ${nombre(m.km)} km${m.infractions ? ` · ⚠ ${m.infractions}` : ""}`)), el("div", { class: "rail" }, rempli)),
        el("span", { class: "droite petit" }, m.brut ? euros(m.net) : "—"), el("span", { class: "suite" }, "›"));
    })),
  ];
}

// ------------------------------------------------------------ réglages
function texteNombre(v) {
  return String(v).replace(".", ",");
}

function champ(c, valeurs) {
  let saisie;
  if (c.genre === "coche") {
    saisie = el("span", { class: "interrupteur" }, el("input", { type: "checkbox", checked: c.valeur, "aria-label": c.libelle }), el("i"));
    valeurs.push([c, () => saisie.querySelector("input").checked]);
  } else if (c.genre === "choix") {
    saisie = el("select", { "aria-label": c.libelle }, c.choix.map(([v, n]) => el("option", { value: v, selected: v === c.valeur }, n)));
    valeurs.push([c, () => saisie.value]);
  } else {
    saisie = el("input", { type: "text", "aria-label": c.libelle, inputmode: c.genre === "nombre" || c.genre === "seuil" ? "decimal" : "text", value: c.genre === "nombre" || c.genre === "seuil" ? texteNombre(c.valeur) : c.valeur });
    valeurs.push([c, () => saisie.value]);
  }
  const ligne = el("div", { class: "champ" }, el("label", {}, c.libelle), saisie);
  c.ligne = ligne;
  return ligne;
}

function lignesDetail(detail) {
  const rangs = [];
  const grille = el("div", { class: "detail-cot" }, el("span", {}, "Libellé (vide : ligne retirée)"), el("span", {}, "Taux (%)"), el("span", {}, "Sur (% du brut)"));
  for (let i = 0; i < 6; i++) {
    const d = detail[i];
    const l = el("input", { type: "text", "aria-label": `Ligne ${i + 1}, libellé`, value: d ? d.libelle : "" });
    const p = el("input", { type: "text", inputmode: "decimal", "aria-label": `Ligne ${i + 1}, taux`, value: d ? texteNombre(d.pct) : "" });
    const a = el("input", { type: "text", inputmode: "decimal", "aria-label": `Ligne ${i + 1}, assiette`, value: d ? texteNombre(d.assiette_pct === undefined ? 100 : d.assiette_pct) : "" });
    grille.append(l, p, a);
    rangs.push({ libelle: l, pct: p, assiette_pct: a });
  }
  return { grille, lire: () => rangs.map((r) => ({ libelle: r.libelle.value, pct: r.pct.value, assiette_pct: r.assiette_pct.value })) };
}

function aideInstallation() {
  if (PC) return null; // l'appli PC est déjà installée
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return null;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return el("section", { class: "carte" }, el("h2", {}, "L'installer sur cet appareil"),
    ios ? el("p", { class: "petit" }, "Dans Safari : bouton Partager, puis « Sur l'écran d'accueil ». Sans ça, Safari peut effacer les données après quelques jours sans ouverture.") : invitation ? el("button", { class: "btn fort", type: "button", onclick: installer }, "Installer TachoReader") : el("p", { class: "petit" }, "Dans le menu du navigateur : « Installer l'application » ou « Ajouter à l'écran d'accueil »."));
}

let invitation = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  invitation = e;
});

async function installer() {
  if (!invitation) return;
  invitation.prompt();
  await invitation.userChoice;
  invitation = null;
  afficher(null);
}

async function pageReglages() {
  const d = await q("reglages");
  const valeurs = [];
  let detail = null;
  const groupes = d.groupes.map((g) => {
    const lignes = g.champs.map((c) => champ(c, valeurs));
    if (g.titre === "Cotisations") {
      detail = lignesDetail(d.detail);
      lignes.push(el("h3", { style: "margin:12px 0 6px" }, "Cotisations ligne par ligne"), detail.grille);
    }
    return el("details", { class: "groupe" }, el("summary", {}, g.titre), el("div", { class: "contenu" }, lignes));
  });
  const enregistrer = async () => {
    for (const [c] of valeurs) c.ligne.classList.remove("erreur");
    const r = await q("poser_reglages", [valeurs.map(([c, lire]) => [c.chemin, lire()]), detail ? detail.lire() : null]);
    if (!r.ok) {
      for (const [c] of valeurs) {
        if (r.erreurs.includes(c.libelle)) {
          c.ligne.classList.add("erreur");
          c.ligne.closest("details").open = true;
        }
      }
      toast(`À corriger (nombre, ou heure HH:MM) : ${r.erreurs.join(", ")}`, { erreur: true });
      return;
    }
    toast("Enregistré : tout est recalculé avec ces valeurs.");
    await relireEtat(true);
  };
  const f = d.fichiers;
  return [
    entete("Réglages", "Ils viennent de ton contrat : vérifie-les avec ton bulletin."),
    el("section", { class: "carte" }, el("h2", {}, "Copie de sauvegarde"),
      el("p", { class: "petit" }, f.derniere_copie ? `Dernière copie : le ${new Date(f.derniere_copie * 1000).toLocaleDateString("fr-FR")}.` : "Aucune copie encore. Tes données ne sont que sur cet appareil : envoie-toi une copie de temps en temps, pour la garder sur ton PC."),
      demo ? el("div", { class: "message" }, "Tu es dans la démo : sors-en pour copier tes vraies données.") : null,
      el("div", { class: "boutons" }, el("button", { class: "btn fort", type: "button", disabled: demo, onclick: preparerCopie }, "Faire une copie"), el("button", { class: "btn", type: "button", disabled: demo, onclick: choisirFichier }, "Reprendre une copie"))),
    aideInstallation(),
    el("section", { class: "carte" }, el("h2", {}, "Apparence"), el("div", { class: "puces" }, [["clair", "Clair"], ["sombre", "Sombre"]].map(([t, n]) => el("button", { type: "button", class: `puce${etat.theme === t ? " choisie" : ""}`, onclick: async () => { await q("poser_theme", [t]); await rafraichir(); } }, n))),
      el("div", { class: "champ" }, el("label", { for: "soleil" }, "Plein soleil", el("span", { class: "doux petit", style: "display:block" }, "Tout devient opaque : plus lisible dehors, moins de verre.")),
        el("span", { class: "interrupteur" }, el("input", { type: "checkbox", id: "soleil", checked: document.documentElement.classList.contains("soleil"), onchange: (e) => { vibrer(); poserSoleil(e.target.checked); } }), el("i")))),
    groupes,
    f.cartes.length ? el("details", { class: "groupe" }, el("summary", {}, `Fichiers de carte gardés (${f.cartes.length})`), el("div", { class: "contenu" }, f.cartes.map((nom) => el("button", { type: "button", class: "ligne-btn", onclick: () => recupererCarte(nom) }, el("span", { class: "milieu petit" }, nom), el("span", { class: "suite" }, "›"))))) : null,
    el("div", { class: "barre-enregistrer" }, el("button", { class: "btn fort", type: "button", style: "width:100%", onclick: enregistrer }, "Enregistrer les réglages")),
    el("button", { class: "btn", type: "button", onclick: async () => {
      if (!(await confirmer("Remettre tous les réglages par défaut ?", "Tes taux et tes règles reviennent aux valeurs de départ. Tes données de carte ne bougent pas.", "Remettre par défaut"))) return;
      await q("reglages_par_defaut");
      toast("Réglages par défaut remis.");
      await rafraichir();
    } }, "Valeurs par défaut"),
    el("p", { class: "doux petit", style: "text-align:center" }, "La carte n'est jamais modifiée. Rien ne quitte cet appareil sans que tu l'envoies toi-même."),
  ];
}

async function preparerCopie() {
  vibrer();
  const r = await q("copie");
  if (!r.ok) return toast(r.message, { erreur: true });
  etat.derniere_copie = Math.floor(Date.now() / 1000);
  ouvrirFeuille([
    el("h2", {}, "Ta copie est prête"),
    el("p", {}, `${r.nom} : toutes tes données et ${accorder(r.cartes, "fichier de carte", "fichiers de carte")}.`),
    el("p", { class: "doux petit" }, "Envoie-la-toi (mail, Fichiers, AirDrop…). Sur le PC : py -3 cli.py copie reprendre, ou Paramètres > Sauvegardes."),
    el("button", { class: "btn fort", type: "button", onclick: () => envoyer(r.nom, r.octets) }, "Envoyer / enregistrer"),
  ]);
  return rafraichir();
}

async function recupererCarte(nom) {
  const r = await q("fichier", [], { nom });
  if (!r.chemin) return toast("Fichier introuvable.", { erreur: true });
  ouvrirFeuille([el("h2", {}, r.nom), el("button", { class: "btn fort", type: "button", onclick: () => envoyer(r.nom, r.octets) }, "Envoyer / enregistrer")]);
  return null;
}

// ------------------------------------------------------------ fichiers entrants
function boutonCarte() {
  return PC ? el("button", { class: "btn fort", type: "button", onclick: lireCarte }, "Lire ma carte") : null;
}

async function lireCarte() {
  // Appli PC : le programme Rust lit la carte (SELECT et READ BINARY seulement), en fait un .ddd, puis on l'ajoute comme un fichier.
  vibrer();
  const note = el("p", { class: "doux" }, "Ne retire pas la carte pendant la lecture.");
  ouvrirFeuille([el("h2", {}, "Lecture de la carte…"), note]);
  const arreter = await PC.event.listen("carte-progression", (e) => { note.textContent = e.payload; });
  let r;
  try {
    r = await PC.core.invoke("lire_carte");
  } catch (e) {
    remplirFeuille([el("h2", {}, "Carte non lue"), el("div", { class: "message rouge" }, String(e)),
      el("button", { class: "btn fort", type: "button", onclick: fermerFeuille }, "Fermer")]);
    return;
  } finally {
    arreter();
  }
  await recevoirFichiers([new File([new Uint8Array(r.octets)], r.nom)]);
  if (r.erreurs.length) toast(`Parties non lues sur la carte : ${r.erreurs.join(", ")}.`, { erreur: true });
  if (r.copie) toast(`Copie gardée : ${r.copie}`);
}

function choisirFichier() {
  vibrer();
  $("#choix-fichier").click();
}

function estCopie(octets) {
  const o = new Uint8Array(octets, 0, Math.min(2, octets.byteLength));
  return o[0] === 0x50 && o[1] === 0x4B; // un .zip commence par « PK »
}

async function recevoirFichiers(fichiers) {
  if (!fichiers.length) return;
  if (demo) await sortirDemo();
  ouvrirFeuille([el("h2", {}, "Lecture du fichier…"), el("p", { class: "doux" }, "Quelques secondes.")]);
  const resultats = [];
  let moisLu = null;
  for (const f of fichiers) {
    let octets;
    try {
      octets = await f.arrayBuffer();
    } catch (e) {
      resultats.push({ ok: false, nom: f.name, message: "fichier inaccessible" });
      continue;
    }
    if (estCopie(octets)) {
      await proposerReprise(f.name, octets);
      return;
    }
    const r = await q("importer", [], { nom: f.name, octets });
    resultats.push(r);
    if (r.ok && r.mois.length) moisLu = r.mois[r.mois.length - 1];
  }
  await relireEtat(false);
  if (moisLu) M = { a: moisLu[0], m: moisLu[1] };
  const bien = resultats.some((r) => r.ok);
  if (bien) vibrer();
  remplirFeuille([
    el("h2", {}, bien ? "✔ C'est enregistré" : "Fichier non lu"),
    resultats.map((r) => el("div", { class: `message ${r.ok ? "vert" : "rouge"}` }, el("strong", {}, r.nom), el("div", {}, r.message),
      r.ok && r.non_lus.length ? el("div", {}, `Parties non lues : ${r.non_lus.join(", ")}.`) : null)),
    el("button", { class: "btn fort", type: "button", onclick: fermerFeuille }, bien ? "Voir mes heures" : "Fermer"),
  ]);
  await afficher({ dy: "8px" });
}

async function proposerReprise(nom, octets) {
  const oui = await confirmer("Reprendre cette copie ?", `${nom} remplace ce qui est affiché ici. L'état actuel est mis de côté et aucun fichier de carte n'est supprimé.`, "Reprendre la copie");
  if (!oui) return;
  const r = await q("reprendre", [], { octets });
  if (!r.ok) {
    toast(`Copie refusée : ${r.message}`, { erreur: true });
    return;
  }
  toast(`Copie reprise${r.ajoutees ? `, ${accorder(r.ajoutees, "fichier de carte ajouté", "fichiers de carte ajoutés")}` : ""}.`);
  await relireEtat(false);
  location.hash = "accueil";
  await afficher({ dy: "8px" });
}

function activerDepot() {
  let niveau = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); niveau++; $("#depot").hidden = false; });
  addEventListener("dragleave", () => { niveau--; if (niveau <= 0) { niveau = 0; $("#depot").hidden = true; } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault();
    niveau = 0;
    $("#depot").hidden = true;
    recevoirFichiers([...e.dataTransfer.files]).catch(erreurGenerale);
  });
}

function erreurGenerale(e) {
  toast(`Problème : ${e.message}`, { erreur: true });
}

// ------------------------------------------------------------ démo
async function entrerDemo() {
  vibrer();
  demo = true;
  await q("demo");
  await relireEtat(false);
  toast("Démo : une carte simulée, rien n'est gardé.");
  fermerFeuille();
  location.hash = "accueil";
  await afficher({ dy: "8px" });
}

async function sortirDemo() {
  demo = false;
  await q("sortir_demo");
  await relireEtat(false);
  await afficher({ dy: "8px" });
}

// ------------------------------------------------------------ feuille du bas
let feuilleOuverte = false;

function remplirFeuille(contenu) {
  const corps = $("#feuille-corps");
  corps.replaceChildren(...[contenu].flat(Infinity).filter(Boolean));
  $("#feuille").classList.remove("plein");
}

function ouvrirFeuille(contenu) {
  remplirFeuille(contenu);
  $("#feuille-corps").scrollTop = 0;
  if (feuilleOuverte) return;
  feuilleOuverte = true;
  $("#voile").hidden = false;
  $("#feuille").hidden = false;
  document.body.style.overflow = "hidden";
  void $("#feuille").offsetWidth;
  $("#voile").classList.add("ouvert");
  $("#feuille").classList.add("ouvert");
  history.pushState({ feuille: true }, "");
}

function cacherFeuille() {
  if (!feuilleOuverte) return;
  feuilleOuverte = false;
  $("#voile").classList.remove("ouvert");
  const f = $("#feuille");
  f.classList.remove("ouvert", "tire");
  f.style.transform = "";
  document.body.style.overflow = "";
  setTimeout(() => {
    if (feuilleOuverte) return;
    $("#voile").hidden = true;
    f.hidden = true;
  }, 300);
}

function fermerFeuille() {
  if (!feuilleOuverte) return;
  cacherFeuille();
  if (history.state && history.state.feuille) history.back(); // retire l'entrée posée à l'ouverture
}

function confirmer(titre, texte, oui) {
  return new Promise((fini) => {
    ouvrirFeuille([
      el("h2", {}, titre), el("p", {}, texte),
      el("div", { class: "boutons" },
        el("button", { class: "btn fort", type: "button", onclick: () => { fermerFeuille(); fini(true); } }, oui),
        el("button", { class: "btn", type: "button", onclick: () => { fermerFeuille(); fini(false); } }, "Annuler")),
    ]);
  });
}

function activerFeuille() {
  $("#voile").addEventListener("click", fermerFeuille);
  $("#fermer-feuille").addEventListener("click", fermerFeuille);
  addEventListener("keydown", (e) => { if (e.key === "Escape") fermerFeuille(); });
  addEventListener("popstate", () => cacherFeuille());
  // Tirer la poignée vers le bas pour fermer
  const p = $("#poignee");
  let y0 = null;
  p.addEventListener("pointerdown", (e) => { y0 = e.clientY; p.setPointerCapture(e.pointerId); $("#feuille").classList.add("tire"); });
  p.addEventListener("pointermove", (e) => { if (y0 !== null) $("#feuille").style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  p.addEventListener("pointerup", (e) => {
    const f = $("#feuille");
    f.classList.remove("tire");
    f.style.transform = "";
    if (y0 !== null && e.clientY - y0 > 90) fermerFeuille();
    y0 = null;
  });
}

// ------------------------------------------------------------ démarrage
function appuiGeneral() {
  // Toute promesse ratée d'un bouton finit en message, jamais en silence
  addEventListener("unhandledrejection", (e) => erreurGenerale(e.reason || new Error("erreur inconnue")));
}

async function moteurPret() {
  await relireEtat(false);
  construireNav();
  activerBalayage();
  activerFeuille();
  activerDepot();
  $("#sortir-demo").addEventListener("click", () => sortirDemo().catch(erreurGenerale));
  $("#choix-fichier").addEventListener("change", (e) => {
    const liste = [...e.target.files];
    e.target.value = "";
    recevoirFichiers(liste).catch(erreurGenerale);
  });
  addEventListener("hashchange", () => afficher({ dy: "8px" }));
  $("#app").hidden = false;
  await afficher({ dy: "8px" });
  $("#demarrage").classList.add("fini");
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

async function demarrer() {
  poserApparence(memoire("theme") === "sombre" ? "sombre" : "clair", memoire("animations") !== "0");
  poserSoleil(memoire("soleil") === "1");
  appuiGeneral();
  await preparerHorsLigne();
  avancerDemarrage("Démarrage…", 0.05);
  $("#demarrage-note").textContent = "";
  travailleur = new Worker("travailleur.js");
  travailleur.onmessage = surMessage;
  travailleur.onerror = (e) => echecDemarrage(e.message || "le moteur n'a pas pu se charger");
}

demarrer();

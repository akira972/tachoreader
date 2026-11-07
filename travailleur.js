// Le moteur Python tourne ici, à part de l'écran : l'interface reste fluide pendant les calculs.
importScripts("pyodide/pyodide.js");

const DOSSIER = "/donnees";
const DOSSIER_DEMO = "/donnees_demo";
const ECHANGE = "/tmp/echange";
let py = null;
let reel = null;
let demo = null;
let actif = null;

function avancer(texte, part) {
  postMessage({ avancer: texte, part });
}

function synchroniser(lire) {
  return new Promise((ok, non) => py.FS.syncfs(lire, (e) => (e ? non(e) : ok())));
}

async function demarrer() {
  avancer("Démarrage de Python…", 0.15);
  py = await loadPyodide({ indexURL: "pyodide/" });
  avancer("Préparation de la base…", 0.55);
  await py.loadPackage("sqlite3", { messageCallback: () => {} });
  avancer("Chargement du moteur…", 0.75);
  const zip = await (await fetch("moteur.zip")).arrayBuffer();
  py.unpackArchive(zip, "zip", { extractDir: "/moteur" });
  py.FS.mkdirTree(DOSSIER);
  py.FS.mount(py.FS.filesystems.IDBFS, {}, DOSSIER);
  avancer("Lecture de tes données…", 0.88);
  await synchroniser(true);
  py.FS.mkdirTree(ECHANGE);
  py.runPython("import sys, json; sys.path.insert(0, '/moteur'); import moteur");
  reel = py.runPython(`moteur.Moteur(${JSON.stringify(DOSSIER)})`);
  actif = reel;
  avancer("Prêt", 1);
}

// Appel d'une méthode du moteur : arguments et réponse passent en JSON, seul format commun aux deux mondes
function appeler(methode, args) {
  py.globals.set("_m", actif);
  py.globals.set("_nom", methode);
  py.globals.set("_args", JSON.stringify(args || []));
  const texte = py.runPython("json.dumps(getattr(_m, _nom)(*json.loads(_args)), ensure_ascii=False)");
  return JSON.parse(texte);
}

const ECRITURES = new Set(["importer", "poser_reglages", "poser_theme", "reglages_par_defaut", "poser_absence", "poser_note", "poser_decouche", "poser_panier",
  "retirer_panier", "acquitter", "documents", "creer_copie", "reprendre_copie"]);

async function traiter(q) {
  switch (q.action) {
    case "importer": {
      const chemin = `${ECHANGE}/${Date.now()}.ddd`;
      py.FS.writeFile(chemin, new Uint8Array(q.octets));
      try {
        return await garder(() => appeler("importer", [q.nom, chemin]));
      } finally {
        py.FS.unlink(chemin);
      }
    }
    case "reprendre": {
      const chemin = `${ECHANGE}/reprise.zip`;
      py.FS.writeFile(chemin, new Uint8Array(q.octets));
      try {
        return await garder(() => appeler("reprendre_copie", [chemin]));
      } finally {
        py.FS.unlink(chemin);
      }
    }
    case "copie": {
      const r = await garder(() => appeler("creer_copie", [ECHANGE]));
      if (r.ok) {
        r.octets = py.FS.readFile(r.chemin).slice().buffer;
        py.FS.unlink(r.chemin);
      }
      return r;
    }
    case "documents": {
      const r = await garder(() => appeler("documents", q.args));
      for (const d of r.documents) d.octets = py.FS.readFile(d.chemin).slice().buffer;
      return r;
    }
    case "fichier": {
      const r = appeler("fichier_carte", [q.nom]);
      if (r.chemin) r.octets = py.FS.readFile(r.chemin).slice().buffer;
      return r;
    }
    case "demo": {
      if (!demo) {
        py.FS.mkdirTree(DOSSIER_DEMO);
        demo = py.runPython(`moteur.Moteur(${JSON.stringify(DOSSIER_DEMO)})`);
        actif = demo;
        appeler("charger_demo");
      }
      actif = demo;
      return { ok: true };
    }
    case "sortir_demo":
      actif = reel;
      return { ok: true };
    default:
      return ECRITURES.has(q.action) ? garder(() => appeler(q.action, q.args)) : appeler(q.action, q.args);
  }
}

// Après une écriture, le disque du navigateur est mis à jour tout de suite (la démo reste en mémoire seulement)
async function garder(fn) {
  const r = fn();
  if (actif === reel) await synchroniser(false);
  return r;
}

let file = Promise.resolve();
onmessage = (e) => {
  const q = e.data;
  file = file.then(async () => {
    try {
      const reponse = await traiter(q);
      const transferts = [];
      if (reponse && reponse.octets) transferts.push(reponse.octets);
      if (reponse && reponse.documents) for (const d of reponse.documents) if (d.octets) transferts.push(d.octets);
      postMessage({ id: q.id, reponse }, transferts);
    } catch (err) {
      postMessage({ id: q.id, erreur: String((err && err.message) || err) });
    }
  });
};

demarrer().then(() => postMessage({ pret: true })).catch((err) => postMessage({ echec: String((err && err.message) || err) }));

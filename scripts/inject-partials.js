// Sustituye marcadores <!--#include NOMBRE--> por el contenido de
// assets/partials/NOMBRE.html en cada página pública de la raíz. Se
// ejecuta como parte del build command en Netlify, igual que
// inject-config.js — no toca nada dentro de admin/.
//
// La mayoría de páginas usan <!--#include header--> / <!--#include footer-->,
// pero hay variantes (p.ej. index.html tiene enlaces de anclas en vez de
// enlaces a página, cuenta.html no se enlaza a sí misma) — cada variante
// es simplemente otro fichero en assets/partials/ con su propio marcador.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const partialsDir = path.join(root, "assets", "partials");

const partials = {};
for (const file of fs.readdirSync(partialsDir)) {
  if (!file.endsWith(".html")) continue;
  const name = file.slice(0, -".html".length);
  partials[name] = fs.readFileSync(path.join(partialsDir, file), "utf8").trim();
}

const pages = fs.readdirSync(root).filter((f) => f.endsWith(".html"));

let changed = 0;
for (const file of pages) {
  const filePath = path.join(root, file);
  let contents = fs.readFileSync(filePath, "utf8");
  const original = contents;
  for (const [name, html] of Object.entries(partials)) {
    contents = contents.split(`<!--#include ${name}-->`).join(html);
  }
  if (contents !== original) {
    fs.writeFileSync(filePath, contents, "utf8");
    changed++;
  }
}

console.log(`[inject-partials] Marcadores sustituidos en ${changed} página(s).`);

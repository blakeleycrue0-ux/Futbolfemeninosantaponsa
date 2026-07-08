// Sustituye los marcadores del template por variables de entorno reales
// y escribe assets/js/config.js. Se ejecuta como build command en Netlify.
const fs = require("fs");
const path = require("path");

const templatePath = path.join(__dirname, "..", "assets", "js", "config.template.js");
const outPath = path.join(__dirname, "..", "assets", "js", "config.js");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[inject-config] SUPABASE_URL / SUPABASE_ANON_KEY no definidas. " +
    "La web se generará sin conexión a Supabase (modo contenido estático)."
  );
}

let contents = fs.readFileSync(templatePath, "utf8");
contents = contents
  .split("__SUPABASE_URL__").join(SUPABASE_URL)
  .split("__SUPABASE_ANON_KEY__").join(SUPABASE_ANON_KEY);

fs.writeFileSync(outPath, contents, "utf8");
console.log(`[inject-config] Escrito ${outPath}`);

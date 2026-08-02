/*
  media-upload.js
  ============================================================================
  Conecta un <input type="file"> a un <input type="url"> de un formulario de
  admin: al elegir una foto/vídeo del dispositivo, la sube al bucket público
  "spfc-media" de Supabase Storage y rellena el campo de URL con el enlace
  público resultante — así nadie necesita saber qué es una URL ni alojar
  nada por su cuenta, solo "elegir archivo".

  Uso: wireMediaUpload({ fileInputId, urlInputId, statusId, folder })
  Requiere que window.spfc ya esté inicializado (supabase-client.js) y que
  el usuario haya iniciado sesión como admin (política spfc_media_admin_write).
  ============================================================================
*/
function wireMediaUpload(opts) {
  const fileInput = document.getElementById(opts.fileInputId);
  const urlInput = document.getElementById(opts.urlInputId);
  const statusEl = opts.statusId ? document.getElementById(opts.statusId) : null;
  if (!fileInput || !urlInput) return;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!window.spfc) {
      if (statusEl) statusEl.textContent = "Supabase no está configurado.";
      return;
    }
    if (statusEl) statusEl.textContent = "Subiendo…";

    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${opts.folder || "uploads"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await window.spfc.storage.from("spfc-media").upload(path, file, { upsert: false });
    if (error) {
      if (statusEl) statusEl.textContent = "Error al subir: " + error.message;
      return;
    }
    const { data } = window.spfc.storage.from("spfc-media").getPublicUrl(path);
    urlInput.value = data.publicUrl;
    urlInput.dispatchEvent(new Event("input", { bubbles: true }));
    if (statusEl) statusEl.textContent = "Subido ✓";
    fileInput.value = "";
  });
}

/*
  mi-cuenta-widget.js
  ============================================================================
  Botón "Mi cuenta" + modal de login con Google y favoritas, inyectados en
  tiempo de ejecución en cualquier página que cargue este script (necesita
  un <span id="mcw-mount"></span> en el header y, antes de este script,
  la cadena habitual: supabase-js, config.js, supabase-client.js).

  Publica window.mcwSession / window.mcwFavorites y llama a
  window.mcwOnFavoritesChanged() (si existe) cada vez que cambian, para
  que otras páginas —hoy solo index.html— puedan reaccionar sin recargar.
  ============================================================================
*/
(function () {
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var mount = document.getElementById("mcw-mount");
    if (!mount) return;

    var MAX_FAVORITOS = 3;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mcw-btn";
    btn.id = "mcwBtn";
    btn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '<span class="mcw-btn-label" id="mcwBtnLabel">Mi cuenta</span>';
    mount.appendChild(btn);

    var overlay = document.createElement("div");
    overlay.className = "mcw-overlay";
    overlay.id = "mcwOverlay";
    overlay.innerHTML =
      '<div class="mcw-backdrop" id="mcwBackdrop"></div>' +
      '<div class="mcw-modal" role="dialog" aria-modal="true" aria-labelledby="mcwTitle">' +
      '  <button type="button" class="mcw-close" id="mcwClose" aria-label="Cerrar">✕</button>' +
      '  <div class="mcw-body">' +
      '    <div id="mcwLoggedOut">' +
      '      <h2 class="mcw-title" id="mcwTitle">Mi cuenta</h2>' +
      '      <p class="mcw-lede">Inicia sesión con Google y marca hasta 3 jugadoras favoritas para tenerlas siempre a mano.</p>' +
      '      <button type="button" class="mcw-google-btn" id="mcwGoogleBtn">' +
      '        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.87 2.69-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.99v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.71A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.71V4.96H.99A9 9 0 0 0 0 9c0 1.45.35 2.83.99 4.04l2.96-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .99 4.96l2.96 2.33C4.66 5.16 6.65 3.58 9 3.58z"/></svg>' +
      "        Iniciar sesión con Google" +
      "      </button>" +
      '      <p class="mcw-status" id="mcwLoginStatus"></p>' +
      "    </div>" +
      '    <div id="mcwLoggedIn" style="display:none;">' +
      '      <div class="mcw-user-row"><span class="mcw-user-email" id="mcwUserEmail"></span><button type="button" class="btn btn-outline btn-sm" id="mcwLogoutBtn">Cerrar sesión</button></div>' +
      '      <p class="mcw-fav-heading">Tus favoritas</p>' +
      '      <p class="mcw-fav-sub">Hasta 3 jugadoras — aparecen destacadas en la portada.</p>' +
      '      <div id="mcwFavoritas"></div>' +
      '      <div id="mcwAddWrap" class="mcw-search-wrap" style="display:none;">' +
      '        <input type="text" id="mcwSearchInput" placeholder="Busca una jugadora por nombre…" autocomplete="off">' +
      '        <div id="mcwSearchResults" class="mcw-search-results" style="display:none;"></div>' +
      "      </div>" +
      '      <p id="mcwFavStatus" class="mcw-status"></p>' +
      "    </div>" +
      "  </div>" +
      "</div>";
    document.body.appendChild(overlay);

    function openModal() {
      overlay.classList.add("mcw-open");
      document.body.style.overflow = "hidden";
    }
    function closeModal() {
      overlay.classList.remove("mcw-open");
      document.body.style.overflow = "";
    }
    btn.addEventListener("click", openModal);
    document.getElementById("mcwClose").addEventListener("click", closeModal);
    document.getElementById("mcwBackdrop").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
    window.mcwOpen = openModal;

    var googleBtn = document.getElementById("mcwGoogleBtn");
    var loginStatus = document.getElementById("mcwLoginStatus");
    var loggedOutEl = document.getElementById("mcwLoggedOut");
    var loggedInEl = document.getElementById("mcwLoggedIn");
    var userEmailEl = document.getElementById("mcwUserEmail");
    var logoutBtn = document.getElementById("mcwLogoutBtn");
    var favoritasEl = document.getElementById("mcwFavoritas");
    var addWrap = document.getElementById("mcwAddWrap");
    var searchInput = document.getElementById("mcwSearchInput");
    var searchResults = document.getElementById("mcwSearchResults");
    var favStatus = document.getElementById("mcwFavStatus");
    var btnLabel = document.getElementById("mcwBtnLabel");

    if (!window.spfc) {
      loginStatus.textContent = "Esta sección todavía no está disponible.";
      googleBtn.disabled = true;
      return;
    }

    googleBtn.addEventListener("click", async function () {
      googleBtn.disabled = true;
      loginStatus.textContent = "Conectando con Google…";
      var res = await window.spfc.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href },
      });
      if (res.error) {
        loginStatus.textContent = "No se ha podido iniciar sesión: " + res.error.message;
        googleBtn.disabled = false;
      }
    });

    logoutBtn.addEventListener("click", async function () {
      logoutBtn.disabled = true;
      await window.spfc.auth.signOut();
      window.location.reload();
    });

    var sesionUsuarioId = null;

    async function cargarFavoritos(userId) {
      favoritasEl.innerHTML = "Cargando…";
      var r = await window.spfc
        .from("user_favorites")
        .select("id, player_id, players(id, nombre, dorsal, posicion, foto_url, team_id)")
        .eq("user_id", userId)
        .order("creado_en");
      if (r.error) {
        favoritasEl.innerHTML = '<p class="mcw-empty">No se han podido cargar tus favoritas.</p>';
        return [];
      }
      var favs = r.data || [];
      favoritasEl.innerHTML = "";
      if (!favs.length) {
        favoritasEl.innerHTML = '<p class="mcw-empty">Todavía no tienes ninguna jugadora favorita.</p>';
      } else {
        favs.forEach(function (fav) {
          var j = fav.players;
          if (!j) return;
          var div = document.createElement("div");
          div.className = "mcw-fav-item";
          div.innerHTML =
            '<img class="mcw-fav-foto" src="' + (j.foto_url || "assets/img/escudo-santa-ponsa.png") + '" alt="">' +
            '<div class="mcw-fav-info"><p class="mcw-fav-nombre">' + (j.nombre || "") + "</p>" +
            '<p class="mcw-fav-meta">' + [j.dorsal ? "Dorsal " + j.dorsal : null, j.posicion].filter(Boolean).join(" · ") + "</p></div>" +
            '<button type="button" class="mcw-fav-quitar" data-fav-id="' + fav.id + '">Quitar</button>';
          favoritasEl.appendChild(div);
        });
        favoritasEl.querySelectorAll("[data-fav-id]").forEach(function (b) {
          b.addEventListener("click", async function () {
            b.disabled = true;
            await window.spfc.from("user_favorites").delete().eq("id", b.dataset.favId);
            var favs2 = await cargarFavoritos(userId);
            actualizarBuscador(favs2);
            window.mcwFavorites = favs2;
            if (window.mcwOnFavoritesChanged) window.mcwOnFavoritesChanged();
          });
        });
      }
      return favs;
    }

    function actualizarBuscador(favs) {
      if ((favs || []).length >= MAX_FAVORITOS) {
        addWrap.style.display = "none";
        favStatus.textContent = "Ya tienes 3 jugadoras favoritas — quita alguna para añadir otra.";
      } else {
        addWrap.style.display = "block";
        favStatus.textContent = "";
      }
    }

    var buscarTimeout;
    searchInput.addEventListener("input", function () {
      clearTimeout(buscarTimeout);
      var q = searchInput.value.trim();
      if (!q) {
        searchResults.style.display = "none";
        return;
      }
      buscarTimeout = setTimeout(async function () {
        var r = await window.spfc.from("players").select("id, nombre, dorsal, foto_url").ilike("nombre", "%" + q + "%").limit(8);
        var jugadoras = r.data || [];
        searchResults.innerHTML = "";
        if (!jugadoras.length) {
          searchResults.innerHTML = '<div class="mcw-search-result mcw-empty">Sin resultados</div>';
        } else {
          jugadoras.forEach(function (j) {
            var item = document.createElement("div");
            item.className = "mcw-search-result";
            item.innerHTML =
              '<img src="' + (j.foto_url || "assets/img/escudo-santa-ponsa.png") + '" alt=""><span>' +
              j.nombre + (j.dorsal ? " (" + j.dorsal + ")" : "") + "</span>";
            item.addEventListener("click", function () {
              anadirFavorito(j.id);
            });
            searchResults.appendChild(item);
          });
        }
        searchResults.style.display = "block";
      }, 250);
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".mcw-search-wrap")) searchResults.style.display = "none";
    });

    async function anadirFavorito(playerId) {
      if (!sesionUsuarioId) return;
      searchInput.value = "";
      searchResults.style.display = "none";
      favStatus.textContent = "Añadiendo…";
      var r = await window.spfc.from("user_favorites").insert({ user_id: sesionUsuarioId, player_id: playerId });
      if (r.error) {
        favStatus.textContent = r.error.code === "23505" ? "Ya la tenías en favoritos." : "No se ha podido añadir: " + r.error.message;
        return;
      }
      var favs = await cargarFavoritos(sesionUsuarioId);
      actualizarBuscador(favs);
      window.mcwFavorites = favs;
      if (window.mcwOnFavoritesChanged) window.mcwOnFavoritesChanged();
    }

    async function mostrarSesion(session) {
      window.mcwSession = session || null;
      if (!session) {
        loggedOutEl.style.display = "block";
        loggedInEl.style.display = "none";
        btn.classList.remove("mcw-in");
        btnLabel.textContent = "Mi cuenta";
        sesionUsuarioId = null;
        window.mcwFavorites = [];
        if (window.mcwOnFavoritesChanged) window.mcwOnFavoritesChanged();
        return;
      }
      sesionUsuarioId = session.user.id;
      loggedOutEl.style.display = "none";
      loggedInEl.style.display = "block";
      userEmailEl.textContent = session.user.email || "";
      btn.classList.add("mcw-in");
      var meta = session.user.user_metadata || {};
      var nombreCorto = meta.full_name || meta.name || session.user.email || "Mi cuenta";
      btnLabel.textContent = nombreCorto.split(" ")[0];
      var favs = await cargarFavoritos(session.user.id);
      actualizarBuscador(favs);
      window.mcwFavorites = favs;
      if (window.mcwOnFavoritesChanged) window.mcwOnFavoritesChanged();
    }

    window.spfc.auth.getSession().then(function (r) {
      mostrarSesion(r.data.session);
    });
    window.spfc.auth.onAuthStateChange(function (_event, session) {
      mostrarSesion(session);
    });
  });
})();

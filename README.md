# Futbol Femenino Santa Ponsa — Web del club

Web pública + panel de administración del club, en HTML/CSS/JS puro
(sin frameworks), con Supabase como base de datos/auth/storage y Netlify
como hosting + funciones serverless.

## Estructura

```
index.html, equipos.html, plantilla.html, jugadora.html,
calendario.html, clasificacion.html, partido.html,
noticias.html, noticia.html, galeria.html, club.html,
socios.html, patrocinadores.html, contacto.html   → web pública

admin/                                             → panel privado (Supabase Auth)
assets/css/                                        → variables.css, base.css, components.css, admin.css
assets/js/                                         → supabase-client.js, data.js, nav.js, config.template.js
netlify/functions/ffib-sync.js                     → scraping FFIB (scheduled function)
supabase/schema.sql                                → esquema completo + RLS
scripts/inject-config.js                           → inyecta las env vars públicas en el build
```

## Cómo funciona la integración con la FFIB

La Federació de Futbol de les Illes Balears (ffib.es) **no tiene API pública**.
`netlify/functions/ffib-sync.js` hace scraping de sus páginas HTML de
jornada/clasificación con `cheerio`, cada pocas horas (cron configurado en
`netlify.toml`), y guarda el resultado en las tablas `matches` y
`ffib_standings` de Supabase. La web pública **siempre lee de Supabase**,
nunca llama a ffib.es directamente. Si el scraping falla (cambian su HTML),
la web sigue mostrando el último dato cacheado y el fallo queda registrado
en `ffib_sync_log`, visible desde el panel admin (`admin/dashboard.html`),
donde también hay un botón para forzar una sincronización manual. El
formulario de partidos del panel admin permite introducir resultados a
mano en cualquier momento como último recurso.

**Importante:** si ffib.es cambia la maquetación de sus páginas, el parser
de `ffib-sync.js` puede dejar de encontrar los datos correctos. Revisa los
comentarios al principio de ese fichero — explican qué ajustar.

## Despliegue

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Ejecuta `supabase/schema.sql` en el SQL Editor del proyecto (crea tablas,
   políticas RLS, el bucket de Storage `spfc-media` y una semilla mínima).
3. Crea el usuario/s de administración en **Authentication → Users** (email +
   contraseña) y añade su email a la tabla `app_admins`:
   ```sql
   insert into app_admins (email) values ('secretariaspfc@gmail.com');
   ```
4. Anota `Project URL` y `anon public key` (Settings → API) y también la
   `service_role key` (esta última es secreta, solo para la función de
   scraping).

### 2. Localizar el `cod_primaria` de la FFIB

1. Entra en [ffib.es](https://www.ffib.es), navega hasta la competición
   femenina donde juega el Femenino Santa Ponsa (grupo/categoría correctos).
2. Copia el valor de `cod_primaria` (y `cod_competicion` si aparece) de la
   URL de la página de jornada/clasificación de ese grupo.
3. Guarda ese valor como `FFIB_COMPETITION_ID`.

### 3. Netlify

1. Conecta este repositorio en Netlify (Import from Git).
2. Build command: `npm run build` (ya viene definido en `netlify.toml`).
   Publish directory: `.`
3. Define las variables de entorno del sitio (Site settings → Environment
   variables):

   | Variable | Descripción |
   |---|---|
   | `SUPABASE_URL` | URL del proyecto Supabase |
   | `SUPABASE_ANON_KEY` | Clave anónima pública (se inyecta en el cliente) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio, **solo** para `ffib-sync.js` |
   | `FFIB_COMPETITION_ID` | `cod_primaria` localizado en el paso 2 |
   | `FFIB_TEAM_ID` | `id` (uuid) del primer equipo en la tabla `teams` |

4. Despliega. La scheduled function `ffib-sync` se ejecutará según el cron
   definido en `netlify.toml` (`0 */6 * * *` por defecto — cada 6 horas).

### 4. Desarrollo local

```bash
npm install
cp .env.example .env         # rellena los valores
npx netlify-cli dev          # sirve la web + las functions localmente
```

Si solo quieres previsualizar el HTML/CSS sin Supabase, basta con abrir los
ficheros directamente o servir la carpeta con cualquier servidor estático;
las páginas caen automáticamente en contenido de ejemplo cuando no detectan
configuración de Supabase (ver `assets/js/supabase-client.js`).

## Panel admin

`admin/index.html` — login con Supabase Auth. Solo los emails presentes en
`app_admins` pueden leer/escribir en las tablas de gestión (ver políticas
RLS en `supabase/schema.sql`); cualquier otro usuario autenticado solo tiene
acceso de lectura pública, igual que un visitante anónimo.

Secciones: Resumen (estadísticas + sincronización FFIB manual), Noticias,
Plantilla (equipos + jugadoras), Partidos (calendario/resultados manuales),
Galería, Patrocinadores, Socias (solicitudes del formulario público).

## Aviso legal sobre el scraping

Los datos de clasificación/resultados sincronizados automáticamente
provienen de páginas públicas de ffib.es. No existe ningún acuerdo ni
integración oficial con la Federació de Futbol de les Illes Balears — es
lectura de su web pública, igual que haría un navegador. Si la FFIB
solicitara el cese de esta práctica, debe desactivarse la scheduled
function y pasar a introducir los resultados manualmente desde el panel
admin.

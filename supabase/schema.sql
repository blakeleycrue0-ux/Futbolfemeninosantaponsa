-- ============================================================================
-- Fútbol Femenino Santa Ponça — esquema Supabase
-- Ejecutar en el SQL Editor de Supabase (o via `supabase db push`).
-- Idempotente: puede volver a ejecutarse sin duplicar objetos.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Rol de administrador
-- La app admin usa Supabase Auth (email/password). Cualquier usuario
-- autenticado cuyo email esté en app_admins puede escribir en las tablas
-- de gestión. Añade aquí a las personas del club con acceso al panel.
-- ----------------------------------------------------------------------------
create table if not exists app_admins (
  email text primary key
);

alter table app_admins enable row level security;

create or replace function is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ----------------------------------------------------------------------------
-- teams
-- ----------------------------------------------------------------------------
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null,
  temporada text not null default '2025/26',
  slug text unique,
  orden int not null default 0,
  creado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- players
-- ----------------------------------------------------------------------------
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  nombre text not null,
  dorsal int,
  posicion text check (posicion in ('Portera','Defensa','Centrocampista','Delantera')),
  foto_url text,
  fecha_nacimiento date,
  bio text,
  goles int not null default 0,
  partidos_jugados int not null default 0,
  tarjetas_amarillas int not null default 0,
  tarjetas_rojas int not null default 0,
  activa boolean not null default true,
  -- si esta jugadora se dio de alta sola al completar el pago (ver
  -- mark-pago-pagado.js), aquí queda el id de la inscripción de origen —
  -- evita añadirla dos veces si se vuelve a marcar como pagada por error.
  -- Sin clave foránea porque `inscripciones` se define más abajo en este
  -- mismo archivo (players va antes) — incluso lo trata como token de
  -- referencia, igual que el resto de la app.
  inscripcion_id uuid,
  -- Enlace personal fijo de la familia para mi-jugadora.html (convocatorias,
  -- asistencia...) — no hace falta contraseña, el token hace de llave,
  -- igual que el id de inscripción en pago.html/registro.html.
  access_token uuid not null default gen_random_uuid(),
  creado_en timestamptz not null default now()
);

create index if not exists players_team_idx on players(team_id);
create unique index if not exists players_inscripcion_idx on players(inscripcion_id) where inscripcion_id is not null;
create unique index if not exists players_access_token_idx on players(access_token);

-- ----------------------------------------------------------------------------
-- matches
-- fuente: 'manual' (introducido en admin) o 'ffib' (scraping automático)
-- ----------------------------------------------------------------------------
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  rival text not null,
  rival_escudo_url text,
  fecha date not null,
  hora time,
  condicion text not null check (condicion in ('local','visitante')),
  competicion text,
  jornada text,
  campo text,
  estado text not null default 'programado' check (estado in ('programado','jugado','aplazado','suspendido')),
  goles_equipo int,
  goles_rival int,
  cronica text,
  video_url text,
  fuente text not null default 'manual' check (fuente in ('manual','ffib')),
  ffib_source_id text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists matches_team_fecha_idx on matches(team_id, fecha desc);
create unique index if not exists matches_ffib_source_idx on matches(ffib_source_id) where ffib_source_id is not null;

-- ----------------------------------------------------------------------------
-- training_sessions
-- Entrenamientos programados por equipo — para poder convocar jugadoras
-- igual que a un partido (ver convocatorias).
-- ----------------------------------------------------------------------------
create table if not exists training_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  fecha date not null,
  hora time,
  lugar text,
  notas text,
  creado_en timestamptz not null default now()
);

create index if not exists training_sessions_team_fecha_idx on training_sessions(team_id, fecha desc);

-- ----------------------------------------------------------------------------
-- convocatorias
-- Una fila por jugadora citada a un partido o entrenamiento (nunca los
-- dos a la vez — de ahí el check). La familia confirma o rechaza desde
-- su enlace personal (mi-jugadora.html?token=...), sin necesitar cuenta
-- ni contraseña — el token vive en players.access_token. Sin política de
-- lectura/escritura pública a propósito: todo pasa por
-- get-mi-jugadora.js / responder-convocatoria.js (service_role), que
-- comprueban el token antes de dejar tocar nada.
-- ----------------------------------------------------------------------------
create table if not exists convocatorias (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  training_id uuid references training_sessions(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  estado_asistencia text not null default 'pendiente' check (estado_asistencia in ('pendiente','confirma','rechaza')),
  respondido_en timestamptz,
  creado_en timestamptz not null default now(),
  constraint convocatoria_un_solo_evento check (
    (match_id is not null and training_id is null) or (match_id is null and training_id is not null)
  )
);

create unique index if not exists convocatorias_match_player_uniq on convocatorias(match_id, player_id) where match_id is not null;
create unique index if not exists convocatorias_training_player_uniq on convocatorias(training_id, player_id) where training_id is not null;
create index if not exists convocatorias_player_idx on convocatorias(player_id);

-- ----------------------------------------------------------------------------
-- match_player_stats
-- Minutos/goles/tarjetas de una jugadora en un partido concreto. Los
-- totales de temporada en players (goles, partidos_jugados,
-- tarjetas_amarillas, tarjetas_rojas) se recalculan sumando estas filas
-- cada vez que se guardan estadísticas de un partido (ver
-- admin/partidos.html) — así nunca se desincronizan.
-- ----------------------------------------------------------------------------
create table if not exists match_player_stats (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  minutos int,
  goles int not null default 0,
  tarjetas_amarillas int not null default 0,
  tarjetas_rojas int not null default 0,
  creado_en timestamptz not null default now()
);

create unique index if not exists match_player_stats_uniq on match_player_stats(match_id, player_id);
create index if not exists match_player_stats_player_idx on match_player_stats(player_id);

-- ----------------------------------------------------------------------------
-- pagos_extra
-- Pagos puntuales por jugadora aparte de la cuota de inscripción (viajes,
-- torneos, equipación extra...) — mismo circuito que inscripcion_pagos
-- (transferencia + justificante que revisa el admin) pero con concepto e
-- importe libres, porque no siguen ningún plan fijo. Sin lectura/escritura
-- pública: la familia sube el justificante por function validando el
-- access_token de la jugadora (igual que responder-convocatoria.js).
-- ----------------------------------------------------------------------------
create table if not exists pagos_extra (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  concepto text not null,
  importe numeric not null,
  fecha_vencimiento date,
  estado text not null default 'pendiente' check (estado in ('pendiente','pagado')),
  comprobante_url text,
  comprobante_subido_en timestamptz,
  creado_en timestamptz not null default now()
);

create index if not exists pagos_extra_player_idx on pagos_extra(player_id);
create index if not exists pagos_extra_estado_idx on pagos_extra(estado);

-- ----------------------------------------------------------------------------
-- admin_push_subscriptions
-- Dispositivos del club (admin) que quieren notificación push de avisos
-- internos: nueva solicitud de interés, justificante subido... Tabla
-- separada de push_subscriptions (esa es pública/de las familias) a
-- propósito: aquí hay datos que solo debe ver el club, así que el alta
-- pasa siempre por save-admin-push-subscription.js, que exige estar
-- autenticado como admin — nunca por un endpoint público, para que nadie
-- pueda apuntarse a escondidas a estos avisos.
-- ----------------------------------------------------------------------------
create table if not exists admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  creado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- user_favorites
-- "Mi cuenta" — cualquiera puede entrar con Google (Supabase Auth, no
-- hace falta tabla propia de usuarios) y marcar hasta 3 jugadoras
-- favoritas, para tenerlas destacadas en la portada sin ir a Equipos. A
-- diferencia de mi-jugadora.html (pensado para la familia de esa
-- jugadora, con enlace fijo sin contraseña), esto es para cualquier
-- aficionado/a. Política propia por fila: cada usuario solo ve y toca
-- sus propios favoritos (auth.uid() = user_id) — no hace falta pasar
-- por ninguna function, el cliente ya autenticado puede leer/escribir
-- directo.
-- ----------------------------------------------------------------------------
create table if not exists user_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  creado_en timestamptz not null default now(),
  unique (user_id, player_id)
);

create index if not exists user_favorites_user_idx on user_favorites(user_id);

-- ----------------------------------------------------------------------------
-- ffib_standings
-- Se sobreescribe por completo en cada sincronización de ffib-sync.js
-- (borra y reinserta las filas del team_id correspondiente).
-- ----------------------------------------------------------------------------
create table if not exists ffib_standings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  posicion int not null,
  equipo text not null,
  es_club boolean not null default false,
  pj int not null default 0,
  pg int not null default 0,
  pe int not null default 0,
  pp int not null default 0,
  gf int not null default 0,
  gc int not null default 0,
  puntos int not null default 0,
  actualizado_en timestamptz not null default now()
);

create index if not exists standings_team_idx on ffib_standings(team_id, posicion);

-- ----------------------------------------------------------------------------
-- news
-- ----------------------------------------------------------------------------
create table if not exists news (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  slug text unique,
  resumen text,
  contenido text,
  imagen_url text,
  fecha date not null default current_date,
  autor text,
  publicado boolean not null default true,
  -- se rellena cuando el admin manda esta noticia por email a las familias
  -- registradas (ver send-noticia-email.js) — null = todavía no se ha
  -- enviado por email (solo está en la web).
  email_enviado_en timestamptz,
  -- botón opcional en la noticia (p.ej. "Reservar hora para probar la
  -- equipación" enlazando a citas.html?categoria=...) — se muestra en la
  -- página de la noticia y, si se manda por email, también en el email.
  boton_texto text,
  boton_url text,
  creado_en timestamptz not null default now()
);

create index if not exists news_fecha_idx on news(fecha desc) where publicado;

-- ----------------------------------------------------------------------------
-- gallery
-- ----------------------------------------------------------------------------
create table if not exists gallery (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete set null,
  tipo text not null check (tipo in ('foto','video')),
  url text not null,
  descripcion text,
  fecha date not null default current_date,
  creado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- sponsors
-- ----------------------------------------------------------------------------
create table if not exists sponsors (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  logo_url text,
  url text,
  nivel text not null default 'colaborador' check (nivel in ('principal','colaborador')),
  orden int not null default 0,
  creado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- destacado
-- Banner destacado de portada, genérico y editable desde el admin (no hace
-- falta tocar código para poner/quitar el aviso del campus de verano, el
-- inicio de temporada, etc.). La portada muestra la fila más reciente con
-- activo = true; si no hay ninguna, no se muestra nada.
-- ----------------------------------------------------------------------------
create table if not exists destacado (
  id uuid primary key default gen_random_uuid(),
  activo boolean not null default false,
  titulo text,
  texto text,
  imagen_url text,
  video_url text,
  enlace_url text,
  enlace_texto text,
  actualizado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- members (socias/socios)
-- ----------------------------------------------------------------------------
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text not null,
  telefono text,
  mensaje text,
  estado text not null default 'pendiente' check (estado in ('pendiente','activo','baja')),
  creado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- inscripciones
-- Formulario público de inscripción (inscripcion.html). Cada inscripción
-- genera N filas en inscripcion_pagos según el plan elegido (1, 2 o 4
-- cuotas) — hoy se crean en estado 'pendiente' porque el cobro por Stripe
-- todavía no está conectado; cuando se conecte, el webhook de Stripe
-- actualizará cada cuota a 'pagado' según se completen los cargos.
-- ----------------------------------------------------------------------------
create table if not exists inscripciones (
  id uuid primary key default gen_random_uuid(),
  -- jugadora
  jugadora_nombre text not null,
  jugadora_fecha_nacimiento date,
  jugadora_dni text,
  team_id uuid references teams(id),
  talla_equipacion text,
  -- tutor/madre/padre 1 (obligatorio)
  tutor_nombre text not null,
  tutor_dni text,
  tutor_telefono text not null,
  tutor_email text not null,
  direccion text,
  poblacion text,
  codigo_postal text,
  -- tutor/madre/padre 2 (opcional)
  tutor2_nombre text,
  tutor2_dni text,
  tutor2_telefono text,
  tutor2_email text,
  -- pago
  plan_pago text not null default 'unico' check (plan_pago in ('unico','2_cuotas','4_cuotas')),
  cuota_total numeric,
  acepta_condiciones boolean not null default false,
  -- aceptación de las "Condiciones generales" completas del dossier del
  -- club (no confundir con acepta_condiciones, que es el consentimiento
  -- corto de protección de datos del formulario de interés) — se rellena
  -- junto con el resto del registro en registro.html.
  acepta_condiciones_generales boolean not null default false,
  condiciones_generales_aceptadas_en timestamptz,
  -- autorización de derechos de imagen, un booleano por canal (se rellena
  -- junto con el resto del registro en registro.html, mismo esquema que la
  -- "AUTORIZACIÓN DE DERECHOS DE IMAGEN" en papel del club). false = no
  -- autoriza / todavía no ha completado el registro.
  imagen_redes_sociales boolean not null default false,
  imagen_web boolean not null default false,
  imagen_prensa boolean not null default false,
  imagen_material_promocional boolean not null default false,
  notas text,
  estado text not null default 'pendiente' check (estado in ('pendiente','pago_parcial','pagado','cancelado')),
  -- se rellena cuando el club acepta la solicitud desde el admin y se envía
  -- el email de aceptación (sin precio ni enlace de pago todavía); null =
  -- todavía pendiente de revisar.
  confirmada_en timestamptz,
  -- se rellena cuando, aparte y más adelante, el club pide el pago desde el
  -- admin y se envía el email con el enlace a pago.html.
  pago_solicitado_en timestamptz,
  -- se rellena cuando la familia completa el formulario de registro.html
  -- (DNI, dirección, talla, segundo tutor…) — solo llega ese enlace una vez
  -- que confirmada_en no es null. null = todavía sin completar.
  registro_completado_en timestamptz,
  creado_en timestamptz not null default now()
);

create index if not exists inscripciones_team_idx on inscripciones(team_id);

-- ----------------------------------------------------------------------------
-- inscripcion_pagos
-- Un plazo por fila. stripe_payment_intent_id / stripe_checkout_session_id
-- quedan vacíos hasta que se conecte Stripe.
-- ----------------------------------------------------------------------------
create table if not exists inscripcion_pagos (
  id uuid primary key default gen_random_uuid(),
  inscripcion_id uuid not null references inscripciones(id) on delete cascade,
  numero_cuota int not null,
  importe numeric,
  fecha_vencimiento date,
  estado text not null default 'pendiente' check (estado in ('pendiente','pagado','fallido')),
  stripe_payment_intent_id text,
  recordatorio_enviado boolean not null default false,
  -- recordatorio_enviado = aviso de "vence mañana"; este otro es el aviso
  -- de "vence hoy" — son dos avisos independientes, cada uno una sola vez
  -- por plazo (ver payment-reminders.js).
  recordatorio_mismo_dia_enviado boolean not null default false,
  -- foto/captura del justificante de la transferencia bancaria, subida por
  -- la familia desde pago.html (ver upload-comprobante.js) — el club la
  -- revisa antes de marcar la cuota como pagada.
  comprobante_url text,
  comprobante_subido_en timestamptz,
  creado_en timestamptz not null default now()
);

create index if not exists inscripcion_pagos_inscripcion_idx on inscripcion_pagos(inscripcion_id);
create index if not exists inscripcion_pagos_vencimiento_idx on inscripcion_pagos(fecha_vencimiento) where estado = 'pendiente';

-- ----------------------------------------------------------------------------
-- citas_horario
-- Horas para que las familias reserven cita y vengan a probarse la
-- equipación, por categoría. El admin crea los huecos desde
-- admin/citas.html; las familias reservan uno desde citas.html (enlace
-- público con ?categoria=), sin necesitar cuenta. Sin política de lectura
-- pública a propósito: la disponibilidad se sirve desde get-citas.js con
-- la service_role key para no enseñar directamente el nombre/email de
-- quien ha reservado cada hora a cualquiera que abra el enlace.
-- ----------------------------------------------------------------------------
create table if not exists citas_horario (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  fecha date not null,
  hora time not null,
  duracion_min int not null default 15,
  disponible boolean not null default true,
  reservado_nombre text,
  reservado_email text,
  jugadora_nombre text,
  reservado_en timestamptz,
  creado_en timestamptz not null default now()
);

create index if not exists citas_horario_categoria_fecha_idx on citas_horario(categoria, fecha, hora);

-- ----------------------------------------------------------------------------
-- push_subscriptions
-- Una fila por dispositivo/navegador que ha activado las notificaciones
-- push (partidos, noticias). endpoint es único porque lo genera el propio
-- navegador y sirve de identificador natural — al desactivar las
-- notificaciones o si el navegador lo da de baja solo, se borra la fila.
-- Sin política de lectura/escritura pública: todo pasa por
-- save-push-subscription.js / remove-push-subscription.js / send-push.js
-- (service_role) para no exponer los endpoints de nadie.
-- ----------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- si se activa desde mi-jugadora.html, va ligada a esa jugadora — para
  -- poder avisar solo a su familia de sus convocatorias (ver
  -- notificar-convocatoria.js), en vez de a todo el mundo como las
  -- notificaciones generales de partidos/noticias.
  player_id uuid references players(id) on delete cascade,
  creado_en timestamptz not null default now()
);

create index if not exists push_subscriptions_player_idx on push_subscriptions(player_id) where player_id is not null;

-- ----------------------------------------------------------------------------
-- ffib_sync_log
-- Auditoría de cada ejecución de la función de scraping, para depurar
-- cuándo la FFIB cambia su HTML y el parser deja de funcionar.
-- ----------------------------------------------------------------------------
create table if not exists ffib_sync_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  ok boolean not null,
  mensaje text,
  ejecutado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- descuento_marians_reclamos
-- Un registro por jugadora que ha conseguido la tarjeta de descuento de
-- Marian's Sport desde descuento-marians.html. jugadora_nombre +
-- jugadora_fecha_nacimiento identifican a la jugadora (no hay login); si
-- vuelve a pedirla se le devuelve siempre el mismo código en vez de crear
-- uno nuevo (ver check-descuento-marians.js), así el club sabe cuándo lo
-- pidió por primera vez con creado_en.
-- ----------------------------------------------------------------------------
create table if not exists descuento_marians_reclamos (
  id uuid primary key default gen_random_uuid(),
  jugadora_nombre text not null,
  jugadora_fecha_nacimiento date not null,
  codigo text not null unique,
  creado_en timestamptz not null default now()
);

create unique index if not exists descuento_marians_reclamos_jugadora_idx
  on descuento_marians_reclamos(lower(jugadora_nombre), jugadora_fecha_nacimiento);

-- ============================================================================
-- Row Level Security
-- Lectura pública en todo lo que se muestra en la web.
-- Escritura solo para usuarios autenticados presentes en app_admins,
-- salvo `members`, donde cualquiera puede insertar (formulario de socias)
-- pero solo el admin puede leer/gestionar.
-- Las Netlify Functions usan la service_role key, que salta RLS.
-- ============================================================================

alter table teams enable row level security;
alter table players enable row level security;
alter table matches enable row level security;
alter table ffib_standings enable row level security;
alter table news enable row level security;
alter table gallery enable row level security;
alter table sponsors enable row level security;
alter table destacado enable row level security;
alter table members enable row level security;
alter table inscripciones enable row level security;
alter table inscripcion_pagos enable row level security;
alter table citas_horario enable row level security;
alter table push_subscriptions enable row level security;
alter table training_sessions enable row level security;
alter table convocatorias enable row level security;
alter table match_player_stats enable row level security;
alter table pagos_extra enable row level security;
alter table admin_push_subscriptions enable row level security;
alter table user_favorites enable row level security;
alter table ffib_sync_log enable row level security;
alter table descuento_marians_reclamos enable row level security;

-- teams
create policy "teams_public_read" on teams for select using (true);
create policy "teams_admin_write" on teams for all using (is_app_admin()) with check (is_app_admin());

-- players
create policy "players_public_read" on players for select using (true);
create policy "players_admin_write" on players for all using (is_app_admin()) with check (is_app_admin());

-- matches
create policy "matches_public_read" on matches for select using (true);
create policy "matches_admin_write" on matches for all using (is_app_admin()) with check (is_app_admin());

-- ffib_standings
create policy "standings_public_read" on ffib_standings for select using (true);
create policy "standings_admin_write" on ffib_standings for all using (is_app_admin()) with check (is_app_admin());

-- news
create policy "news_public_read" on news for select using (publicado = true or is_app_admin());
create policy "news_admin_write" on news for all using (is_app_admin()) with check (is_app_admin());

-- gallery
create policy "gallery_public_read" on gallery for select using (true);
create policy "gallery_admin_write" on gallery for all using (is_app_admin()) with check (is_app_admin());

-- sponsors
create policy "sponsors_public_read" on sponsors for select using (true);
create policy "sponsors_admin_write" on sponsors for all using (is_app_admin()) with check (is_app_admin());

-- destacado
create policy "destacado_public_read" on destacado for select using (true);
create policy "destacado_admin_write" on destacado for all using (is_app_admin()) with check (is_app_admin());

-- members: alta pública (formulario), lectura y gestión solo admin
create policy "members_public_insert" on members for insert with check (true);
create policy "members_admin_read" on members for select using (is_app_admin());
create policy "members_admin_update" on members for update using (is_app_admin()) with check (is_app_admin());
create policy "members_admin_delete" on members for delete using (is_app_admin());

-- inscripciones: alta pública (formulario), lectura y gestión solo admin
create policy "inscripciones_public_insert" on inscripciones for insert with check (true);
create policy "inscripciones_admin_read" on inscripciones for select using (is_app_admin());
create policy "inscripciones_admin_update" on inscripciones for update using (is_app_admin()) with check (is_app_admin());
create policy "inscripciones_admin_delete" on inscripciones for delete using (is_app_admin());

-- inscripcion_pagos: se crean junto con la inscripción (alta pública),
-- gestión (marcar pagado, etc.) solo admin
create policy "inscripcion_pagos_public_insert" on inscripcion_pagos for insert with check (true);
create policy "inscripcion_pagos_admin_read" on inscripcion_pagos for select using (is_app_admin());
create policy "inscripcion_pagos_admin_update" on inscripcion_pagos for update using (is_app_admin()) with check (is_app_admin());
create policy "inscripcion_pagos_admin_delete" on inscripcion_pagos for delete using (is_app_admin());

-- citas_horario: sin lectura/escritura pública — todo pasa por
-- get-citas.js / reservar-cita.js (service_role); el admin gestiona
-- los huecos directamente porque is_app_admin() se lo permite.
create policy "citas_horario_admin_all" on citas_horario for all using (is_app_admin()) with check (is_app_admin());

-- push_subscriptions: solo admin puede ver cuántas hay (para el contador
-- en el admin) — altas, bajas y envíos van siempre por function con
-- service_role.
create policy "push_subscriptions_admin_read" on push_subscriptions for select using (is_app_admin());

-- training_sessions: el admin/entrenador gestiona directamente (RLS se lo
-- permite); las familias solo lo ven a través de get-mi-jugadora.js.
create policy "training_sessions_admin_all" on training_sessions for all using (is_app_admin()) with check (is_app_admin());

-- convocatorias: el admin/entrenador las crea y gestiona directamente;
-- la respuesta de la familia (confirma/rechaza) pasa siempre por
-- responder-convocatoria.js (service_role), que comprueba el token de la
-- jugadora antes de dejar tocar nada — sin política pública.
create policy "convocatorias_admin_all" on convocatorias for all using (is_app_admin()) with check (is_app_admin());

-- match_player_stats: público como el resto de datos de partidos/plantilla
-- (se muestra en jugadora.html), solo el admin puede escribir.
create policy "match_player_stats_public_read" on match_player_stats for select using (true);
create policy "match_player_stats_admin_write" on match_player_stats for all using (is_app_admin()) with check (is_app_admin());

-- pagos_extra: sin lectura/escritura pública — la familia sube el
-- justificante por function (comprueba el token de la jugadora) y el
-- admin gestiona el resto directamente (RLS se lo permite).
create policy "pagos_extra_admin_all" on pagos_extra for all using (is_app_admin()) with check (is_app_admin());

-- admin_push_subscriptions: sin escritura pública en absoluto — el alta
-- pasa por save-admin-push-subscription.js, que exige is_app_admin().
create policy "admin_push_subscriptions_admin_all" on admin_push_subscriptions for all using (is_app_admin()) with check (is_app_admin());

-- user_favorites: cada usuario logueado con Google solo puede ver y
-- tocar sus propias filas.
create policy "user_favorites_owner_all" on user_favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ffib_sync_log: solo admin (la function usa service_role, que ignora RLS)
create policy "synclog_admin_read" on ffib_sync_log for select using (is_app_admin());

-- descuento_marians_reclamos: sin lectura/escritura pública — el alta la
-- hace siempre check-descuento-marians.js con service_role; el admin solo
-- puede leer la lista de quién lo ha reclamado.
create policy "descuento_marians_reclamos_admin_read" on descuento_marians_reclamos for select using (is_app_admin());

-- ============================================================================
-- Storage: bucket público para fotos/vídeos (jugadoras, noticias, galería,
-- patrocinadores). Subida restringida a administradores autenticados.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('spfc-media', 'spfc-media', true)
on conflict (id) do nothing;

create policy "spfc_media_public_read" on storage.objects
  for select using (bucket_id = 'spfc-media');

create policy "spfc_media_admin_write" on storage.objects
  for insert with check (bucket_id = 'spfc-media' and is_app_admin());

create policy "spfc_media_admin_update" on storage.objects
  for update using (bucket_id = 'spfc-media' and is_app_admin());

create policy "spfc_media_admin_delete" on storage.objects
  for delete using (bucket_id = 'spfc-media' and is_app_admin());

-- ============================================================================
-- Storage: bucket público para los justificantes de transferencia que suben
-- las familias desde pago.html. Solo lo escribe upload-comprobante.js, que
-- usa la service_role key (salta RLS) — por eso no hace falta política de
-- insert, solo la de lectura (para que el admin pueda abrir el enlace).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', true)
on conflict (id) do nothing;

create policy "comprobantes_public_read" on storage.objects
  for select using (bucket_id = 'comprobantes');

-- ============================================================================
-- Semilla: categorías reales del club. Ajustar/ampliar desde el panel admin
-- (Plantilla → Equipos) si cambian de una temporada a otra.
-- ============================================================================
insert into teams (nombre, categoria, temporada, slug, orden)
values
  ('Amateur', 'Amateur', '2025/26', 'amateur', 0),
  ('Cadete Juvenil Femenino', 'Cadete Juvenil', '2025/26', 'cadete-juvenil', 1),
  ('Infantil Femenino', 'Infantil', '2025/26', 'infantil', 2),
  ('Alevín Femenino', 'Alevín', '2025/26', 'alevin', 3)
on conflict do nothing;

-- Categorías nuevas para la 2026/27 (Benjamín, y Cadete/Juvenil ya
-- separados) para que la asignación automática por edad de Plantilla
-- tenga equipo donde encajar a cada jugadora. No se toca ni se borra
-- "Cadete Juvenil Femenino" por si ya tiene jugadoras asignadas.
insert into teams (nombre, categoria, temporada, slug, orden)
values
  ('Benjamín Femenino', 'Benjamín', '2026/27', 'benjamin', -1),
  ('Cadete Femenino', 'Cadete', '2026/27', 'cadete', 4),
  ('Juvenil Femenino', 'Juvenil', '2026/27', 'juvenil', 5)
on conflict do nothing;

-- Club definitivo: solo 4 categorías (2026/27) — Amateur (2007 y antes),
-- Cadete Juvenil (2008-2012), Infantil (2013-2014), Benjamín Alevín
-- (2015-2018). "Alevín Femenino" se renombra a "Benjamín Alevín Femenino"
-- en vez de borrarla (evita perder jugadoras ya asignadas por el
-- "on delete cascade" de players.team_id). "Benjamín Femenino",
-- "Cadete Femenino" y "Juvenil Femenino" (arriba) quedan sin uso: si
-- están vacíos, se pueden borrar a mano desde el admin.
update teams
set nombre = 'Benjamín Alevín Femenino', categoria = 'Benjamín Alevín'
where categoria = 'Alevín';

-- Ahora son 5 categorías: se renombra "Amateur" a "3ª RFEF" y se añade
-- "Regional" como segundo equipo sénior. La edad para el precio de 450€
-- (19 años o más) no cambia — sigue calculándose solo por fecha de
-- nacimiento, sin depender del nombre de la categoría.
update teams
set nombre = '3ª RFEF', categoria = '3ª RFEF', orden = 0
where categoria = 'Amateur';

insert into teams (nombre, categoria, temporada, slug, orden)
values ('Regional', 'Regional', '2026/27', 'regional', 1)
on conflict do nothing;

update teams set orden = 2 where categoria = 'Cadete Juvenil';
update teams set orden = 3 where categoria = 'Infantil';
update teams set orden = 4 where categoria = 'Benjamín Alevín';

-- Tipo de partido (Liga/Copa/Torneo/Amistoso), elegible al programar un
-- partido desde el admin. Los partidos ya existentes se marcan como "Liga"
-- por defecto (es lo que eran hasta ahora).
alter table matches add column if not exists tipo text not null default 'Liga';
alter table matches drop constraint if exists matches_tipo_check;
alter table matches add constraint matches_tipo_check check (tipo in ('Liga','Copa','Torneo','Amistoso'));

-- Segundo vídeo opcional por partido (p.ej. 1ª y 2ª parte por separado).
alter table matches add column if not exists video_url_2 text;

-- "EN DIRECTO": el club lo activa a mano desde el panel (Partidos) al
-- empezar a retransmitir con la cámara Falcon (XbotGo) a YouTube — no hay
-- forma de detectarlo automáticamente, la cámara no avisa a la web.
-- en_directo_desde sirve para que la portada deje de mostrarlo sola pasadas
-- unas horas, por si se olvida quitarlo a mano.
alter table matches add column if not exists en_directo boolean not null default false;
alter table matches add column if not exists en_directo_desde timestamptz;

-- Tallas confirmadas al probarse la equipación en la cita (una columna por
-- prenda). Se rellenan a mano en el admin, normalmente pasando lo apuntado
-- en papel durante la propia cita — ver admin/citas-imprimir.html.
alter table citas_horario add column if not exists talla_camiseta_partido text;
alter table citas_horario add column if not exists talla_camiseta_entreno text;
alter table citas_horario add column if not exists talla_sudadera text;
alter table citas_horario add column if not exists talla_chaqueta_chandal text;
alter table citas_horario add column if not exists talla_pantalon text;
alter table citas_horario add column if not exists talla_pantalon_chandal text;

-- Recuerda añadir tu email de administrador, p.ej.:
-- insert into app_admins (email) values ('secretariaspfc@gmail.com');

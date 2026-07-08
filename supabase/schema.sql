-- ============================================================================
-- Futbol Femenino Santa Ponsa — esquema Supabase
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
  creado_en timestamptz not null default now()
);

create index if not exists players_team_idx on players(team_id);

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
alter table members enable row level security;
alter table ffib_sync_log enable row level security;

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

-- members: alta pública (formulario), lectura y gestión solo admin
create policy "members_public_insert" on members for insert with check (true);
create policy "members_admin_read" on members for select using (is_app_admin());
create policy "members_admin_update" on members for update using (is_app_admin()) with check (is_app_admin());
create policy "members_admin_delete" on members for delete using (is_app_admin());

-- ffib_sync_log: solo admin (la function usa service_role, que ignora RLS)
create policy "synclog_admin_read" on ffib_sync_log for select using (is_app_admin());

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
-- Semilla mínima: primer equipo. Ajustar/ampliar desde el panel admin.
-- ============================================================================
insert into teams (nombre, categoria, temporada, slug, orden)
values ('Primer Equipo', 'Preferente Femenina', '2025/26', 'primer-equipo', 0)
on conflict do nothing;

-- Recuerda añadir tu email de administrador, p.ej.:
-- insert into app_admins (email) values ('secretariaspfc@gmail.com');

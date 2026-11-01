-- The workspace schema. Every row belongs to an organization, and the only
-- authorization layer is the policy on each table reading the organization off
-- the Clerk session token.
--
-- RLS is enabled explicitly on every table below rather than left to the
-- project's dashboard setting that auto-enables it: that setting isn't in
-- version control and swallows its own failures, so a fresh database built
-- from these files alone has to come out locked down.

-- ---------------------------------------------------------------------------
-- The organization claim
-- ---------------------------------------------------------------------------

-- Not exposed through the Data API; policies call into it.
create schema if not exists private;
grant usage on schema private to authenticated;

-- Clerk's v2 session token nests the active organization under `o`; v1 put it
-- at `org_id`. Both are signed by Clerk, so reading either is equally
-- trustworthy. This is Supabase's documented pattern for Clerk. Null when no
-- organization is active, which matches no row.
create function private.current_org_id()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')
$$;

revoke execute on function private.current_org_id() from public;
grant execute on function private.current_org_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Mirrors a Clerk organization so the rows below have something to cascade
-- from. The id is Clerk's, not ours.
create table public.organizations (
  id text primary key check (id like 'org\_%'),
  name text not null,
  created_at timestamptz not null default now()
);

-- A repository. One per repository per organization.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  owner text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, owner, name),
  -- Target for the composite foreign keys below.
  unique (id, organization_id)
);

create type public.analysis_status as enum (
  'pending',
  'fetching',
  'selecting',
  'parsing',
  'storing',
  'complete',
  'failed'
);

-- One run over a repository at a commit.
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  status public.analysis_status not null default 'pending',
  commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  -- Composite so a row can't claim one organization while hanging off
  -- another's project. The same shape repeats on every child table.
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  lines integer not null check (lines >= 0),
  content_hash text not null,
  unique (analysis_id, path),
  unique (id, organization_id),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  kind text not null check (kind in ('import', 're_export', 'dynamic_import', 'require')),
  unique (source_file_id, target_file_id, kind),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (source_file_id, organization_id)
    references public.files (id, organization_id) on delete cascade,
  foreign key (target_file_id, organization_id)
    references public.files (id, organization_id) on delete cascade
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  method text not null,
  pattern text not null,
  unique (analysis_id, method, pattern),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (file_id, organization_id)
    references public.files (id, organization_id) on delete cascade
);

-- Keyed on what was explained, its content and the model, so re-pinning a
-- model or changing a file misses the cache rather than serving a stale one.
-- `path` is a file or a folder.
create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  content_hash text not null,
  model text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (analysis_id, path, content_hash, model),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

-- `source` records who assigned the role: path convention, or the model for
-- files convention couldn't identify.
create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  file_id uuid not null unique,
  role text not null,
  source text not null check (source in ('convention', 'model')),
  foreign key (file_id, organization_id)
    references public.files (id, organization_id) on delete cascade
);

-- Facts about the edge list. `paths` holds one file, or every file in a cycle.
create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  kind text not null check (kind in ('unimported', 'high_fan_in', 'oversized', 'cycle')),
  paths text[] not null check (cardinality(paths) > 0),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Indexes: every policy filters on organization_id, and every foreign key
-- column gets one so cascades don't scan. Columns already leading a unique
-- constraint are covered.
-- ---------------------------------------------------------------------------

create index analyses_organization_id_idx on public.analyses (organization_id, created_at desc);
create index analyses_project_id_idx on public.analyses (project_id, organization_id);
create index files_organization_id_idx on public.files (organization_id);
create index edges_organization_id_idx on public.edges (organization_id);
create index edges_analysis_id_idx on public.edges (analysis_id, organization_id);
create index edges_source_file_id_idx on public.edges (source_file_id, organization_id);
create index edges_target_file_id_idx on public.edges (target_file_id, organization_id);
create index routes_organization_id_idx on public.routes (organization_id);
create index routes_file_id_idx on public.routes (file_id, organization_id);
create index explanations_organization_id_idx on public.explanations (organization_id);
create index file_roles_organization_id_idx on public.file_roles (organization_id);
create index file_roles_file_id_org_idx on public.file_roles (file_id, organization_id);
create index insights_organization_id_idx on public.insights (organization_id);
create index insights_analysis_id_idx on public.insights (analysis_id, organization_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.projects enable row level security;
alter table public.analyses enable row level security;
alter table public.files enable row level security;
alter table public.edges enable row level security;
alter table public.routes enable row level security;
alter table public.explanations enable row level security;
alter table public.file_roles enable row level security;
alter table public.insights enable row level security;

-- Nothing writes through the API yet, so the only privilege handed out is
-- read, and only to signed-in users. Write policies arrive with the first
-- thing that writes.
revoke all on
  public.organizations, public.projects, public.analyses, public.files,
  public.edges, public.routes, public.explanations, public.file_roles,
  public.insights
from anon, authenticated;

grant select on
  public.organizations, public.projects, public.analyses, public.files,
  public.edges, public.routes, public.explanations, public.file_roles,
  public.insights
to authenticated;

-- The function call is wrapped in a select so Postgres evaluates it once per
-- query instead of once per row.
create policy "Members read their organization"
  on public.organizations for select to authenticated
  using (id = (select private.current_org_id()));

create policy "Members read their organization's projects"
  on public.projects for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members read their organization's analyses"
  on public.analyses for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members read their organization's files"
  on public.files for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members read their organization's edges"
  on public.edges for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members read their organization's routes"
  on public.routes for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members read their organization's explanations"
  on public.explanations for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members read their organization's file roles"
  on public.file_roles for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members read their organization's insights"
  on public.insights for select to authenticated
  using (organization_id = (select private.current_org_id()));

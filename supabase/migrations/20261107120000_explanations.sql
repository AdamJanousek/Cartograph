-- The model's two jobs: explaining a file or folder, and labelling files no
-- adapter could identify. Both are cached on the content of the thing and the
-- exact model, and both caches hang off the analysis rather than its files, so
-- re-analysing a repository keeps every answer whose content didn't change.

-- ---------------------------------------------------------------------------
-- The labelling stage
-- ---------------------------------------------------------------------------

-- After storing: the graph is complete and visible before any model is asked.
alter type public.analysis_status add value 'labelling' after 'storing';

-- ---------------------------------------------------------------------------
-- Labels the model may give
-- ---------------------------------------------------------------------------

-- Page, route and controller decide the route table and the entry-point
-- colouring, so only convention may assign them. The database refuses
-- anything else from the model rather than trusting the prompt to.
alter table public.file_roles
  add constraint file_roles_model_roles_check check (
    source = 'convention'
    or role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook')
  );

-- The labelling cache. `role` is null when the model said it couldn't tell:
-- that answer is cached too, and the file stays unidentified.
create table public.role_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  content_hash text not null,
  model text not null,
  role text check (role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook')),
  created_at timestamptz not null default now(),
  unique (analysis_id, path, content_hash, model),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

alter table public.role_labels enable row level security;

create index role_labels_organization_id_idx on public.role_labels (organization_id);
create index role_labels_analysis_id_idx on public.role_labels (analysis_id, organization_id);

-- ---------------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------------

revoke all on public.role_labels from anon, authenticated;
grant select, insert on public.role_labels to authenticated;

-- Explaining writes its answer back. Never updated: a different answer is a
-- different key.
grant insert on public.explanations to authenticated;

create policy "Members read their organization's role labels"
  on public.role_labels for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members add their organization's role labels"
  on public.role_labels for insert to authenticated
  with check (organization_id = (select private.current_org_id()));

create policy "Members add their organization's explanations"
  on public.explanations for insert to authenticated
  with check (organization_id = (select private.current_org_id()));

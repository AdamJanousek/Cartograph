-- The pipeline writes. A run happens on the server but as the signed-in user,
-- with their Clerk token, so every row it writes passes the same organization
-- policy a read does. There is no service key: a run can only write into the
-- organization whose token it carries.

-- ---------------------------------------------------------------------------
-- What a run records
-- ---------------------------------------------------------------------------

alter table public.analyses
  -- One line saying what the current stage is doing, e.g. how many files.
  add column stage_message text,
  -- Which stage a failed run was in, and why it failed.
  add column failed_stage public.analysis_status
    check (failed_stage not in ('pending', 'complete', 'failed')),
  add column failure text,
  add column frameworks text[] not null default '{}',
  -- The parser's coverage report, as it produced it. Null until stored.
  add column coverage jsonb;

-- The seeded placeholder rows predate the failure columns. Say plainly that
-- they're placeholders rather than invent a reason.
update public.analyses
set failed_stage = 'fetching', failure = 'Seeded placeholder; no run took place.'
where status = 'failed';

alter table public.analyses
  add constraint analyses_failure_recorded check (
    (status = 'failed') = (failure is not null and failed_stage is not null)
  ),
  -- One analysis per repository. Submitting a repository twice finds the
  -- existing row instead of racing to create a second one.
  add constraint analyses_project_id_key unique (project_id);

-- The constraint above leads with project_id, so this index is redundant.
drop index public.analyses_project_id_idx;

-- updated_at is what tells a working run from an abandoned one, so it can't
-- depend on every writer remembering to set it.
create function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger analyses_touch_updated_at
  before update on public.analyses
  for each row execute function private.touch_updated_at();

alter table public.files
  add column bytes integer not null check (bytes >= 0);

-- Whether every import behind this connection is type-only. Same value on
-- each kind row of one pair, because the parser records it per pair.
alter table public.edges
  add column type_only boolean not null;

-- ---------------------------------------------------------------------------
-- Write privileges and policies
-- ---------------------------------------------------------------------------

grant insert on
  public.organizations, public.projects, public.analyses, public.files,
  public.edges, public.file_roles
to authenticated;

-- Only the columns a run moves. Ownership and identity columns stay fixed.
grant update (status, stage_message, failed_stage, failure, commit_sha, frameworks, coverage)
  on public.analyses to authenticated;

-- A failed store removes what it had written, so no half graph is left behind.
grant delete on public.files to authenticated;

create policy "Members add their organization"
  on public.organizations for insert to authenticated
  with check (id = (select private.current_org_id()));

create policy "Members add their organization's projects"
  on public.projects for insert to authenticated
  with check (organization_id = (select private.current_org_id()));

create policy "Members add their organization's analyses"
  on public.analyses for insert to authenticated
  with check (organization_id = (select private.current_org_id()));

create policy "Members update their organization's analyses"
  on public.analyses for update to authenticated
  using (organization_id = (select private.current_org_id()))
  with check (organization_id = (select private.current_org_id()));

create policy "Members add their organization's files"
  on public.files for insert to authenticated
  with check (organization_id = (select private.current_org_id()));

create policy "Members remove their organization's files"
  on public.files for delete to authenticated
  using (organization_id = (select private.current_org_id()));

create policy "Members add their organization's edges"
  on public.edges for insert to authenticated
  with check (organization_id = (select private.current_org_id()));

create policy "Members add their organization's file roles"
  on public.file_roles for insert to authenticated
  with check (organization_id = (select private.current_org_id()));

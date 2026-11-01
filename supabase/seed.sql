-- Placeholder analyses, because nothing creates a real one yet. Safe to re-run:
-- organizations and projects upsert, and an organization's seeded analyses are
-- replaced rather than duplicated.
--
-- Each organization gets different repositories, so switching between them
-- visibly changes the dashboard. Add a row to `orgs` with a real Clerk
-- organization id to seed another one.

with orgs (id, name, ordinal) as (
  values
    ('org_3LQGZoJZR8QBJ81dDIEswL85oRO', 'My Organization', 1),
    ('org_3LSHNkeIPX8xnhCZZzYdJd5WkkU', 'JS Mastery Demo', 2)
),
repos (ordinal, owner, name, status, commit_sha, age) as (
  values
    (1, 'vercel', 'next.js', 'complete'::public.analysis_status, '3f9c2a71e0b4d58a6c1e2f7b9d0a4c6e8b2f1d3a', interval '3 days'),
    (1, 'shadcn-ui', 'ui', 'parsing'::public.analysis_status, 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', interval '2 minutes'),
    (1, 'trpc', 'trpc', 'failed'::public.analysis_status, null, interval '1 day'),
    (2, 'nestjs', 'nest', 'complete'::public.analysis_status, '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291807', interval '5 days'),
    (2, 'expressjs', 'express', 'pending'::public.analysis_status, null, interval '30 seconds')
),
upsert_orgs as (
  insert into public.organizations (id, name)
  select id, name from orgs
  on conflict (id) do update set name = excluded.name
  returning id
),
upsert_projects as (
  insert into public.projects (organization_id, owner, name)
  select orgs.id, repos.owner, repos.name
  from orgs join repos using (ordinal)
  on conflict (organization_id, owner, name) do update set owner = excluded.owner
  returning id, organization_id, owner, name
),
clear_analyses as (
  delete from public.analyses
  where organization_id in (select id from orgs)
)
insert into public.analyses (organization_id, project_id, status, commit_sha, created_at, updated_at)
select p.organization_id, p.id, repos.status, repos.commit_sha, now() - repos.age, now() - repos.age
from upsert_projects p
join orgs on orgs.id = p.organization_id
join repos on repos.ordinal = orgs.ordinal and repos.owner = p.owner and repos.name = p.name;

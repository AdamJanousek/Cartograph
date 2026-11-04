-- Live progress. When a run moves stage, the database publishes the stage and
-- its message on that analysis's own channel, and the progress page and the
-- dashboard subscribe. Nothing in the browser polls.

-- ---------------------------------------------------------------------------
-- The channel pattern
-- ---------------------------------------------------------------------------

-- Each analysis has one private channel, `analysis:<id>`. A private channel
-- with no policy admits nobody, so publishing to it silently goes nowhere;
-- this pattern is what declares the channel. Anything that isn't exactly that
-- shape maps to null and matches no analysis.
create function private.analysis_id_from_topic(topic text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when topic ~ '^analysis:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substr(topic, 10)::uuid
  end
$$;

revoke execute on function private.analysis_id_from_topic(text) from public;
grant execute on function private.analysis_id_from_topic(text) to authenticated;

-- Who may subscribe is the same question as who may read the row, so it's
-- answered by the same policy: the lookup into analyses runs under that
-- table's organization policy. Another organization's analysis isn't found,
-- so its channel can't be joined. There's no insert policy: browsers listen,
-- only the database speaks.
create policy "Members receive their organization's analysis progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.analyses
      where id = private.analysis_id_from_topic((select realtime.topic()))
    )
  );

-- ---------------------------------------------------------------------------
-- Publishing
-- ---------------------------------------------------------------------------

-- Fires on our own table, never on realtime's. Only the stage and its message
-- go out: the subscriber shows them as they are and has nothing to filter.
--
-- Security definer because the run updates the row as a signed-in member, who
-- deliberately has no right to publish to a channel themselves.
create function private.publish_analysis_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('stage', new.status, 'message', new.stage_message),
    'stage',
    'analysis:' || new.id::text,
    true
  );
  return null;
end
$$;

revoke execute on function private.publish_analysis_stage() from public;

create trigger analyses_publish_stage
  after update of status, stage_message on public.analyses
  for each row
  when (old.status is distinct from new.status or old.stage_message is distinct from new.stage_message)
  execute function private.publish_analysis_stage();

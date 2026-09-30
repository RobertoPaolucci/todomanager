begin;

alter table public.google_calendar_events
  add column if not exists gcal_observation_verified boolean not null default false;

comment on column public.google_calendar_events.gcal_observation_verified is
  'True only when Google status and updated timestamp were received directly from the verified Google Calendar webhook payload.';

notify pgrst, 'reload schema';

commit;
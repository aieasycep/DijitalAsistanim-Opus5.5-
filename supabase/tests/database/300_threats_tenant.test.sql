-- pgTAP · THR-11 cross-tenant access and THR-10 cross-user retrieval, attacked as a signed-in user
-- (SECURITY_AND_PRIVACY_PLAN §2 THR-10/THR-11, CTL-3.4, R-13; IMPLEMENTATION_PLAN T-11.05).
-- A sweep over every client-readable table proves user A sees none of user B's rows (with a control
-- sweep as B); writes aimed at B's rows touch nothing; rows cannot be planted under B's id; and
-- RPC-02 search never returns B's content to A.
begin;
select plan(13);

select tests.create_user('alice@tenant.test');
select tests.create_user('bob@tenant.test');
create temporary table tx (k text primary key, id uuid) on commit drop;
grant select on tx to authenticated;
insert into tx values ('b_account', tests.make_account(tests.user_id('bob@tenant.test'), 'bob@gmail.com'));
insert into tx values ('b_calendar', tests.make_calendar(tests.user_id('bob@tenant.test'), (select id from tx where k = 'b_account')));
insert into tx values ('b_event', tests.make_event(tests.user_id('bob@tenant.test'), (select id from tx where k = 'b_account'),
                                                  (select id from tx where k = 'b_calendar'), 'Zümrütanka ihale toplantısı',
                                                  now() + interval '1 day', now() + interval '1 day 1 hour'));
insert into tx values ('b_thread', tests.make_thread(tests.user_id('bob@tenant.test'), (select id from tx where k = 'b_account'),
                                                     'Zümrütanka ihalesi gizli teklif'));
insert into tx values ('b_message', tests.make_message(tests.user_id('bob@tenant.test'), (select id from tx where k = 'b_account'),
                                                       (select id from tx where k = 'b_thread'), 'Zümrütanka ihalesi gizli teklif'));
insert into tx values ('b_insight', tests.make_insight(tests.user_id('bob@tenant.test'), 'Zümrütanka teklifi'));
insert into tx values ('b_commitment', tests.make_commitment(tests.user_id('bob@tenant.test')));
insert into tx values ('b_life', tests.make_life_event(tests.user_id('bob@tenant.test')));
insert into tx values ('b_contact', tests.make_contact(tests.user_id('bob@tenant.test'), 'Zümrüt Anka', 'zumrut@anka.example'));
insert into tx values ('b_memory', tests.make_memory(tests.user_id('bob@tenant.test'), 'Zümrütanka ihalesinde teklif 4,2 milyon TL'));
insert into tx values ('b_approval', tests.make_approval(tests.user_id('bob@tenant.test')));
insert into tx values ('b_install', tests.make_installation(tests.user_id('bob@tenant.test')));
insert into tx values ('a_account', tests.make_account(tests.user_id('alice@tenant.test'), 'alice@gmail.com'));

-- Rows of `p_owner` visible to the current role, per client-readable table with a user_id column.
create or replace function pg_temp.visible_rows_of(p_owner uuid) returns table (tbl text, n bigint)
  language plpgsql
  as $$
declare
  t record;
  v_sql text;
begin
  for t in
    select c.relname::text as name from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and has_column_privilege(current_user, c.oid, a.attnum, 'SELECT')
  loop
    v_sql := format('select count(*) from public.%I where user_id = $1', t.name);
    tbl := t.name;
    execute v_sql into n using p_owner;
    return next;
  end loop;
end
$$;

-- Result of a statement as the current role: 'rows:<n>' or 'error:<sqlstate>'.
create or replace function pg_temp.attempt(p_sql text) returns text
  language plpgsql
  as $$
declare
  v_rows bigint;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return 'error:' || sqlstate;
end
$$;

-- ─── Reads ────────────────────────────────────────────────────────────────────────────────────
select tests.authenticate_as(tests.user_id('bob@tenant.test'));
select cmp_ok((select count(*)::integer from pg_temp.visible_rows_of(tests.user_id('bob@tenant.test')) where n > 0), '>=', 10,
              'control: Bob sees his own rows in at least ten client-readable tables');
select tests.clear_authentication();
select tests.authenticate_as(tests.user_id('alice@tenant.test'));
select ok((select count(*) from pg_temp.visible_rows_of(tests.user_id('alice@tenant.test'))) >= 20,
          'the sweep covers every client-readable table with a user_id');
select is_empty($$ select tbl || ': ' || n from pg_temp.visible_rows_of(tests.user_id('bob@tenant.test')) where n > 0 $$,
                'Alice sees none of Bob''s rows in any client-readable table');
select is((select count(*)::integer from public.email_messages where id = (select id from tx where k = 'b_message')), 0,
          'a guessed row id of another user returns nothing');

-- ─── RPC-02 retrieval (the assistant's only retrieval path, R-13) ─────────────────────────────
select is((select count(*)::integer from public.search_user_content('Zümrütanka')), 0,
          'search never returns another user''s mail, event, insight or memory');
select is((select count(*)::integer from public.search_user_content('Zümrütanka', null, null, null, null,
                                                                      (select id from tx where k = 'b_contact'))), 0,
          'a foreign contact id as a filter reveals nothing');

-- ─── Writes aimed at Bob's rows ───────────────────────────────────────────────────────────────
select is_empty(
  $$ select q from (values
       (pg_temp.attempt(format('update public.insights set status = %L where id = %L', 'done', (select id from tx where k = 'b_insight')))),
       (pg_temp.attempt(format('update public.commitments set status = %L where id = %L', 'done', (select id from tx where k = 'b_commitment')))),
       (pg_temp.attempt(format('update public.life_events set suppressed = true where id = %L', (select id from tx where k = 'b_life')))),
       (pg_temp.attempt(format('update public.contacts set display_name = %L where id = %L', 'x', (select id from tx where k = 'b_contact')))),
       (pg_temp.attempt(format('update public.calendars set selected = false where id = %L', (select id from tx where k = 'b_calendar')))),
       (pg_temp.attempt(format('delete from public.contacts where id = %L', (select id from tx where k = 'b_contact')))),
       (pg_temp.attempt(format('delete from public.memory_chunks where user_id = %L', tests.user_id('bob@tenant.test')))),
       (pg_temp.attempt(format('delete from public.app_installations where id = %L', (select id from tx where k = 'b_install'))))
     ) as v (q) where q <> 'rows:0' and q <> 'error:42501' $$,
  'every update or delete of Bob''s rows affects nothing or is refused');
select throws_ok(format($$ insert into public.contacts (user_id, display_name, primary_email, emails, avatar_seed, origin)
                           values (%L, 'Planted', 'planted@evil.example', array['planted@evil.example']::extensions.citext[], 1, 'manual') $$,
                        tests.user_id('bob@tenant.test')),
                 '42501', null, 'a row cannot be planted under Bob''s user id');
select throws_ok(format($$ select public.set_insight_status(%L, 'done') $$, (select id from tx where k = 'b_insight')),
                 'P0002', null, 'the insight RPC treats another user''s insight as missing');
select throws_ok(format($$ select * from public.effective_entitlement(%L) $$, tests.user_id('bob@tenant.test')),
                 '42501', 'FORBIDDEN', 'another user''s entitlement cannot be read');
select throws_ok(format($$ select public.check_plan_limit('captures_per_day', 5, %L) $$, tests.user_id('bob@tenant.test')),
                 '42501', 'FORBIDDEN', 'another user''s quota cannot be spent');
select tests.clear_authentication();

select results_eq(
  $$ select (select status::text from public.insights where id = (select id from tx where k = 'b_insight')),
            (select display_name from public.contacts where id = (select id from tx where k = 'b_contact')),
            (select selected from public.calendars where id = (select id from tx where k = 'b_calendar')),
            (select count(*)::integer from public.memory_chunks where user_id = tests.user_id('bob@tenant.test')) $$,
  $$ values ('open', 'Zümrüt Anka', true, 1) $$,
  'Bob''s rows are unchanged');
select is((select count(*)::integer from public.contacts where primary_email = 'planted@evil.example'), 0, 'nothing was planted');

select * from finish();
rollback;

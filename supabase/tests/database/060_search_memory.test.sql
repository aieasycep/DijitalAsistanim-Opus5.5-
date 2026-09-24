-- pgTAP · RPC-02 search_user_content (FTS + vector, RRF k = 60, RLS-scoped), memory privacy,
-- person intelligence and rule preview isolation (DATABASE_AND_RLS_PLAN §6.9, §13.2 060).
begin;
select plan(20);

select tests.create_user('pro@search.test');
select tests.create_user('free@search.test');
select tests.make_pro(tests.user_id('pro@search.test'));

create temporary table mem (k text primary key, id uuid) on commit drop;
grant select on mem to authenticated;
insert into mem values
  ('contact', tests.make_contact(tests.user_id('pro@search.test'), 'Ahmet Yılmaz', 'ahmet@kuzeylojistik.com'));
insert into mem values
  ('both', tests.make_memory(tests.user_id('pro@search.test'), 'Kuzey Lojistik revize teklif bugün 17:00''a kadar bekleniyor',
                             tests.axis_vector(1), now() - interval '1 day', array[(select id from mem where k = 'contact')])),
  ('vector_only', tests.make_memory(tests.user_id('pro@search.test'), 'Haftalık ekip toplantısı notları',
                                    tests.axis_vector(1, 0.01), now() - interval '2 days')),
  ('far', tests.make_memory(tests.user_id('pro@search.test'), 'Netflix aboneliği yenileniyor', tests.axis_vector(500),
                            now() - interval '40 days')),
  ('expired', tests.make_memory(tests.user_id('pro@search.test'), 'Eski teklif kaydı', tests.axis_vector(1), now() - interval '3 days')),
  ('free_twin', tests.make_memory(tests.user_id('free@search.test'), 'Kuzey Lojistik revize teklif bugün 17:00''a kadar bekleniyor',
                                  tests.axis_vector(1), now() - interval '1 day'));
update public.memory_chunks set expires_at = now() - interval '1 minute' where id = (select id from mem where k = 'expired');
insert into mem values ('free_contact', tests.make_contact(tests.user_id('free@search.test'), 'Ahmet Yılmaz', 'ahmet@kuzeylojistik.com'));

select tests.authenticate_as(tests.user_id('pro@search.test'));
select throws_ok($$ select embedding from public.memory_chunks $$, '42501', null, 'embedding is not selectable by clients');
select throws_ok($$ select embedding_dr from public.memory_chunks $$, '42501', null, 'embedding_dr is not selectable by clients');
select results_eq($$ select count(*)::integer from public.memory_chunks $$, array[4], 'owner reads her own chunks only');

select results_eq(
  $$ select entity_id from public.search_user_content('teklif', null, array['memory']) $$,
  $$ select id from mem where k = 'both' $$,
  'FTS leg: own unexpired chunk only (expired and other users'' rows excluded)'
);
select results_eq(
  $$ select entity_id from public.search_user_content('', tests.axis_vector(1), array['memory'], null, null, null, null, 1) $$,
  $$ select id from mem where k = 'both' $$,
  'vector leg ranks the exact match first'
);
select results_eq(
  $$ select count(*)::integer from public.search_user_content('', tests.axis_vector(1), array['memory']) $$,
  array[3], 'vector leg returns every unexpired own chunk with an embedding'
);
select ok(
  (select score from public.search_user_content('teklif', tests.axis_vector(1), array['memory'])
   where entity_id = (select id from mem where k = 'both'))
  > (select score from public.search_user_content('teklif', tests.axis_vector(1), array['memory'])
     where entity_id = (select id from mem where k = 'vector_only')),
  'RRF: a chunk found by both legs outranks a vector-only chunk'
);
select is(
  (select round(score::numeric, 6) from public.search_user_content('teklif', tests.axis_vector(1), array['memory'])
   where entity_id = (select id from mem where k = 'both')),
  round(2.0 / 61, 6), 'RRF score = 1/(60+1) + 1/(60+1) for the top hit of both legs'
);
select results_eq(
  $$ select count(*)::integer from public.search_user_content('', tests.axis_vector(1), array['memory'], now() - interval '36 hours') $$,
  array[1], 'p_from filters on source_timestamp'
);
select results_eq(
  $$ select entity_id from public.search_user_content('', tests.axis_vector(1), array['memory'], null, null,
                                                      (select id from mem where k = 'contact')) $$,
  $$ select id from mem where k = 'both' $$, 'p_contact_id restricts to rows linked to the contact'
);
select throws_ok(
  $$ select * from public.search_user_content('teklif', array_fill(0.1::real, array[1536])::extensions.vector) $$,
  '22023', 'VALIDATION_FAILED:query_embedding', 'a 1536-d query vector is rejected'
);
select throws_ok($$ select * from public.search_user_content('x') $$, '22023', 'VALIDATION_FAILED:query', 'a 1-character query is rejected');
select throws_ok($$ select * from public.search_user_content('teklif', null, array['mail']) $$, '22023', 'VALIDATION_FAILED:types',
                 'unknown result type rejected');
select is(
  (select public.person_intelligence((select id from mem where k = 'free_contact'))),
  null::jsonb, 'person_intelligence for another user''s contact returns null'
);
select ok((public.person_intelligence((select id from mem where k = 'contact')) -> 'contact') is not null,
          'person_intelligence for an own contact returns the contact');
select tests.clear_authentication();

select tests.authenticate_as(tests.user_id('free@search.test'));
select results_eq(
  $$ select count(*)::integer from public.search_user_content('teklif', tests.axis_vector(1)) where result_type = 'memory' $$,
  array[0], 'Free: no memory results and no vector leg'
);
select is(cardinality(public.memory_vector_candidates(tests.axis_vector(1))), 0, 'Free: the vector helper returns nothing');
select results_eq($$ select count(*)::integer from public.memory_chunks $$, array[1], 'Free user reads only her own chunk');
select tests.clear_authentication();

select tests.as_anon();
select throws_ok($$ select * from public.search_user_content('teklif') $$, '42501', null, 'anon cannot search');
select tests.clear_authentication();

select tests.authenticate_as(tests.user_id('pro@search.test'));
select is(cardinality(public.memory_vector_candidates(tests.axis_vector(1))), 3,
          'the vector helper only ever ranks the caller''s own chunks');
select tests.clear_authentication();

select * from finish();
rollback;

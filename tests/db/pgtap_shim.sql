-- pgtap_shim.sql - LOCAL ONLY. Just enough of pgTAP for supabase/tests/*.sql
-- to run on a plain Postgres: plan, ok, is, throws_matching, lives_ok,
-- finish. Under `supabase test db` the real pgTAP provides these.
create or replace function plan(n int) returns text language plpgsql security definer as $$
begin
  create temp table if not exists _tap (planned int, ran int, failed int);
  delete from _tap; insert into _tap values (n, 0, 0);
  return format('1..%s', n);
end $$;
create or replace function _tap_mark(pass boolean, descr text) returns text language plpgsql security definer as $$
declare n int;
begin
  update _tap set ran = ran + 1, failed = failed + case when pass then 0 else 1 end returning ran into n;
  return format('%sok %s - %s', case when pass then '' else 'not ' end, n, coalesce(descr, ''));
end $$;
create or replace function ok(pass boolean, descr text default '') returns text language sql as $$ select _tap_mark(coalesce(pass, false), descr) $$;
create or replace function is(got anyelement, want anyelement, descr text default '') returns text language plpgsql as $$
begin
  if got is not distinct from want then return _tap_mark(true, descr); end if;
  return _tap_mark(false, format('%s | got %s, wanted %s', descr, got, want));
end $$;
create or replace function throws_matching(sql text, pattern text, descr text default '') returns text language plpgsql as $$
begin
  execute sql;
  return _tap_mark(false, format('%s | did not throw', descr));
exception when others then
  if sqlerrm ~ pattern then return _tap_mark(true, descr); end if;
  return _tap_mark(false, format('%s | threw "%s", wanted ~ %s', descr, sqlerrm, pattern));
end $$;
create or replace function lives_ok(sql text, descr text default '') returns text language plpgsql as $$
begin
  execute sql;
  return _tap_mark(true, descr);
exception when others then
  return _tap_mark(false, format('%s | threw "%s"', descr, sqlerrm));
end $$;
create or replace function finish() returns setof text language plpgsql security definer as $$
declare t record;
begin
  select * into t from _tap;
  if t.ran <> t.planned then return next format('# Looks like you planned %s tests but ran %s', t.planned, t.ran); end if;
  if t.failed > 0 then return next format('# Looks like you failed %s tests of %s', t.failed, t.ran); end if;
  return;
end $$;
grant execute on all functions in schema public to authenticated, service_role, anon;

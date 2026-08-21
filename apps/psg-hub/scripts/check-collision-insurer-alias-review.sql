begin;

create temporary table alias_check_labels on commit drop as
with review_shop as (
  select candidate.shop_id
  from public.v_collision_insurer_alias_candidates candidate
  where candidate.review_status = 'candidate'
    and candidate.shop_id is not null
  group by candidate.shop_id
  having count(*) >= 2
  order by count(*) desc, candidate.shop_id
  limit 1
)
select
  candidate.shop_id,
  candidate.source_label_normalized
from public.v_collision_insurer_alias_candidates candidate
join review_shop on review_shop.shop_id = candidate.shop_id
where candidate.review_status = 'candidate'
order by candidate.repair_orders desc, candidate.source_label_normalized
limit 2;

create temporary table alias_check_baseline on commit drop as
select labels.shop_id, count(*)::integer as insurer_rows
from public.v_collision_filemaker_insurers insurer
join (select distinct shop_id from alias_check_labels) labels
  on labels.shop_id = insurer.shop_id
group by labels.shop_id;

do $$
begin
  if (select count(*) from alias_check_labels) <> 2 then
    raise exception 'Alias check requires two candidate labels for one mapped shop';
  end if;
  if not exists (select 1 from public.profiles) then
    raise exception 'Alias check requires one profile as the rollback-only reviewer';
  end if;
end;
$$;

update public.collision_insurer_alias_reviews review
set canonical_insurer_key = 'rollback test insurer',
    canonical_insurer_name = 'Rollback Test Insurer',
    review_status = 'approved',
    review_notes = 'Rollback-only alias governance check',
    reviewed_by = (select id from public.profiles order by id limit 1),
    reviewed_at = now()
where review.source_label_normalized in (
  select source_label_normalized from alias_check_labels
);

do $$
begin
  if not exists (
    select 1
    from alias_check_baseline baseline
    where (
      select count(*)
      from public.v_collision_filemaker_insurers insurer
      where insurer.shop_id = baseline.shop_id
    ) = baseline.insurer_rows - 1
  ) then
    raise exception 'Two approved aliases did not collapse to one insurer row';
  end if;
  if not exists (
    select 1
    from public.v_collision_filemaker_insurers insurer
    join alias_check_baseline baseline on baseline.shop_id = insurer.shop_id
    where insurer.insurance_company_normalized = 'rollback test insurer'
      and insurer.insurance_company_name = 'Rollback Test Insurer'
      and insurer.alias_review_status = 'approved'
  ) then
    raise exception 'Approved canonical insurer was not exposed by the analysis view';
  end if;
end;
$$;

rollback;

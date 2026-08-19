-- Record vetted external datasets as research metadata only. Raw third-party rows
-- stay out of the customer database until a concrete product workflow needs them.

alter table public.research_artifacts
  drop constraint if exists research_artifacts_artifact_type_check;

alter table public.research_artifacts
  add constraint research_artifacts_artifact_type_check
  check (artifact_type = any (array[
    'semrush_base',
    'semrush_geo',
    'semrush_competitor',
    'semrush_gap',
    'social_sentiment',
    'social_personas',
    'content_brief',
    'qa_report',
    'sitemap_package',
    'dataset_catalog'
  ]));

insert into public.research_artifacts (artifact_type, source_skill, data)
select
  'dataset_catalog',
  'huggingface-skills:huggingface-datasets',
  jsonb_build_object(
    'catalog_version', '2026-08-18',
    'checked_at', '2026-08-18T14:34:43-05:00',
    'policy', 'Catalog metadata only; no raw third-party data imported.',
    'recommended', jsonb_build_array(
      jsonb_build_object(
        'dataset', 'vic35get/nhtsa_complaints_dataset',
        'url', 'https://huggingface.co/datasets/vic35get/nhtsa_complaints_dataset',
        'decision', 'eval_and_taxonomy',
        'license', 'apache-2.0',
        'rows', 12534,
        'viewer_verified', true,
        'use', 'Evaluate vehicle-component classification and expand safety-language taxonomy.',
        'limits', '2014-2024 complaints; five balanced labels; not collision-repair outcome data.'
      ),
      jsonb_build_object(
        'dataset', 'DrBimmer/comprehensive-car-damage',
        'url', 'https://huggingface.co/datasets/DrBimmer/comprehensive-car-damage',
        'decision', 'future_visual_eval',
        'license', 'mit',
        'rows', 2300,
        'viewer_verified', true,
        'use', 'Evaluate front/rear damage classification if PSG adds a photo-inspection workflow.',
        'limits', 'Six coarse classes; no localization masks; outside the current roadmap.'
      ),
      jsonb_build_object(
        'dataset', 'Yelp/yelp_review_full',
        'url', 'https://huggingface.co/datasets/Yelp/yelp_review_full',
        'decision', 'benchmark_only',
        'license', 'other',
        'rows', 700000,
        'viewer_verified', true,
        'use', 'Generic five-star polarity benchmark only.',
        'limits', 'Yelp Dataset Challenge terms require review; PSG survey and review data is more domain-relevant.'
      )
    ),
    'rejected', jsonb_build_array(
      jsonb_build_object(
        'dataset', 'tugberkkalay/autodamageiq-vehicle-damage-dataset',
        'reason', 'Dataset Viewer cannot infer consistent split formats; mixed CarDD, VehiDE, and GPT-4o HITL provenance.'
      ),
      jsonb_build_object(
        'dataset', 'yusufnull/car-parts-and-damage-dataset',
        'reason', 'Dataset Viewer generation and Parquet export failed.'
      ),
      jsonb_build_object(
        'dataset', 'emperor-mew/nhtsa-complaints',
        'reason', 'Dataset card claims 213k rows, but Dataset Viewer reports an empty dataset.'
      )
    )
  )
where not exists (
  select 1
  from public.research_artifacts
  where artifact_type = 'dataset_catalog'
    and data ->> 'catalog_version' = '2026-08-18'
);

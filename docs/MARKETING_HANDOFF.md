# Marketing handoff: Mission 02

## Result

- 30 ASAP GTA6 + 30 ASAP Katy concepts, eight hypothesis families.
- 10 unique first-wave units, five per brand, with 30 exact platform captions/texts.
- 7-day matrix: 30 proposed publication cells + 12 observation cells; not enqueued.
- Ten existing source JPEG references inspected. No media generated, no audio reused, no external publication, no account binding, no actual performance data.

Threads/Facebook text variants are editorially complete. Instagram text and selected JPEG are prepared; rights/use decision, staging, capabilities, destination identity and readback remain technical/editorial preflight. No account ID has been guessed. Use the first successful test as the first planned post on that route.

## Copy exactly these paths into the isolated ASAP repository

- docs/ASAP_MARKETING_RESEARCH.md
- docs/7_DAY_EXPERIMENT_PLAN.md
- docs/FIRST_10_COPYBOOK.md
- docs/MARKETING_HANDOFF.md
- docs/EXTRA_MARKETING_INPUT.md (merge into engineering-owned docs/EXTRA_ROADMAP.md; do not overwrite that file)
- content/content_pool.json
- content/first_wave.json
- content/first_wave_assets.json
- content/claim_register.json
- content/seven_day_matrix.json
- content/metrics_contract.json
- qa/MARKETING_QA.json
- qa/validate_marketing.py

Only these files are integration deliverables. Do not copy the entire work directory, raw source_context.json. Intermediate generators were removed after review to prevent stale regeneration. The raw context snapshot contains complete private source documents and is unnecessary for runtime. Image bytes are not included in the copy allowlist; source manifests contain paths/hashes and existing Drive references for permitted retrieval/staging.

## Integration contract

project_id = ASAP_TEAM_AUTOPILOT. Brand IDs are ASAP_GTA6 and ASAP_KATY. account_key = null until API-verified binding. content_id + content_version identify the editorial unit; variant_id/text_sha256 identify platform copy; the asset hash pins exact image bytes.

The engine is the only publication-state owner. Adapt this JSON to the actually verified Distribution ContentEnvelope and queue interface; do not assume these draft JSON fields are already a production API schema. Exact-job idempotency requires account/platform/content/version. Separately use topic_family_id and brand_topic_family_key to review near duplicates. A unique content ID is not a semantic duplicate check.

Rolling 7-day semantic review is a proposed editorial guardrail, not an eternal ban. G01/G28 are the same broad camera topic; G02/G10 share neon nostalgia. Cross-brand same-file hash or near-identical wording also requires review. Platform adaptation is allowed, but it is one core item, not three independent hypothesis replications.

At publishing time recheck source-sensitive claims. IDs/permalinks must come from successful provider responses/readback. Ambiguous timeouts need reconciliation before retry. Date/slot fields remain null until genuine scheduling. Metric values remain null until observed; late-but-successfully-read values stay available and carry a separate window_status.

## Asset traps already handled

1. Generated cover38 remains held; the original SOURCE-38 Keys01 image is separately selected for G04’s evidence-limit commentary. Cover43 stays excluded.
2. SOURCE-42 Keys02 is the scooter/street scene. It is not the wide coastal vista. K16 now uses the visible scooter accurately.
3. SOURCE-23 is a narrow portrait reference; it cannot prove lawn watering. G06/K05/K14 need the actual full scene inspected before media production.
4. SOURCE-14 is an official 720p proxy frame418 /13.933s. Do not transfer headline/pink-accent COVER edits onto its source provenance. Some legacy thumbnail fields in the upstream manifest still reference T1-S011; use selected compact-reference hash and actual_reference_original. Do not claim an unverified crop.
5. Source QA does not clear the known longform Free-voice licensing issue. None of that audio is used.

## Completion boundary

Marketing drafting is complete when QA passes and this allowlist is delivered. The overall mission remains open until engineering publishes, verifies route/account IDs, restores durable scheduling and returns actual 24h/72h metrics or specific blockers. The last planned D7 posts mature at D10 at the earliest; do not report a final performance winner on D7.

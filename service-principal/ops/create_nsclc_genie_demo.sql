-- Synthetic-only clinical data for the Vault CRM headless Genie demo.
-- The cohort mirrors the source Genie Agent's visible distributions and exact
-- ECOG benchmark answer without copying any source patient-level records.

CREATE SCHEMA IF NOT EXISTS af_vault_genie_demo.nsclc_rwe
COMMENT 'Disclosed synthetic advanced NSCLC real-world-evidence data for Genie demonstrations';

CREATE OR REPLACE TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master
USING DELTA
COMMENT 'Synthetic, disclosed advanced NSCLC cohort. One denormalized row per fictional patient; no PHI or real patient records.'
TBLPROPERTIES (
  'delta.enableChangeDataFeed' = 'true',
  'demo.synthetic_data' = 'true',
  'demo.contains_phi' = 'false'
)
AS
WITH patient_ids AS (
  SELECT CAST(id AS BIGINT) AS id
  FROM range(49915)
),
dimension_keys AS (
  SELECT
    *,
    pmod(id * 2, 49915) AS k_sex,
    pmod(id * 3, 49915) AS k_age,
    pmod(id * 7, 49915) AS k_histology,
    pmod(id * 11, 49915) AS k_smoking,
    pmod(id * 13, 49915) AS k_pdl1,
    pmod(id * 17, 49915) AS k_regimen,
    CASE
      WHEN id < 17367 THEN 0
      WHEN id < 37355 THEN 1
      WHEN id < 45828 THEN 2
      ELSE 3
    END AS ecog_ps,
    CASE
      WHEN id < 17367 THEN id
      WHEN id < 37355 THEN id - 17367
      WHEN id < 45828 THEN id - 37355
      ELSE id - 45828
    END AS ecog_rank,
    CASE
      WHEN id < 17367 THEN 17367
      WHEN id < 37355 THEN 19988
      WHEN id < 45828 THEN 8473
      ELSE 4087
    END AS ecog_count,
    CASE
      WHEN id < 17367 THEN 14.06D
      WHEN id < 37355 THEN 12.84D
      WHEN id < 45828 THEN 8.28D
      ELSE 5.95D
    END AS ecog_median_os
  FROM patient_ids
),
clinical_dimensions AS (
  SELECT
    *,
    CASE WHEN k_sex < 27464 THEN 'Male' ELSE 'Female' END AS sex,
    CASE
      WHEN k_age < 24828 THEN '50-64'
      WHEN k_age < 44391 THEN '65-74'
      WHEN k_age < 48608 THEN '75+'
      ELSE '<50'
    END AS age_group,
    CASE
      WHEN k_histology < 35078 THEN 'Adenocarcinoma'
      WHEN k_histology < 47411 THEN 'Squamous cell carcinoma'
      ELSE 'NSCLC NOS/Other'
    END AS histology,
    CASE
      WHEN k_smoking < 24793 THEN 'Former'
      WHEN k_smoking < 39960 THEN 'Current'
      ELSE 'Never'
    END AS smoking_status,
    CASE
      WHEN k_pdl1 < 17522 THEN '<1%'
      WHEN k_pdl1 < 34952 THEN '1-49%'
      ELSE '>=50%'
    END AS pdl1_tps,
    CASE
      WHEN k_regimen < 20648 THEN 'Carboplatin + Pemetrexed + Pembrolizumab'
      WHEN k_regimen < 33181 THEN 'Pembrolizumab monotherapy'
      WHEN k_regimen < 41542 THEN 'Carboplatin + Paclitaxel + Pembrolizumab'
      WHEN k_regimen < 48499 THEN 'Osimertinib'
      ELSE 'Alectinib'
    END AS first_line_regimen,
    CASE
      WHEN k_regimen < 20648 THEN 'Chemo-IO'
      WHEN k_regimen < 33181 THEN 'IO monotherapy'
      WHEN k_regimen < 41542 THEN 'Chemo-IO'
      ELSE 'Targeted TKI'
    END AS first_line_class,
    CASE
      WHEN k_regimen < 9394 THEN 'KRAS'
      WHEN k_regimen < 41542 THEN 'No actionable driver'
      WHEN k_regimen < 48499 THEN 'EGFR'
      ELSE 'ALK'
    END AS primary_driver,
    CAST(ROUND(ecog_median_os + (ecog_rank - ((ecog_count - 1) / 2.0D)) * 0.001D, 2) AS DECIMAL(15,2)) AS os_months_observed,
    CASE
      WHEN ecog_rank >= CAST(FLOOR(ecog_count * 0.1D) AS BIGINT)
       AND ecog_rank < ecog_count - CAST(FLOOR(ecog_count * 0.1D) AS BIGINT)
      THEN 1 ELSE 0
    END AS event_flag
  FROM dimension_keys
),
costed AS (
  SELECT
    *,
    CASE first_line_regimen
      WHEN 'Carboplatin + Pemetrexed + Pembrolizumab' THEN 142491.79D
      WHEN 'Pembrolizumab monotherapy' THEN 135666.28D
      WHEN 'Carboplatin + Paclitaxel + Pembrolizumab' THEN 136772.66D
      WHEN 'Osimertinib' THEN 289860.98D
      ELSE 427293.20D
    END + (pmod(id * 37, 2001) - 1000) * 25.0D AS total_cost_of_care,
    CASE first_line_class
      WHEN 'Targeted TKI' THEN 0.76D
      WHEN 'IO monotherapy' THEN 0.59D
      ELSE 0.47D
    END + (pmod(id * 23, 21) - 10) / 1000.0D AS pharmacy_share
  FROM clinical_dimensions
)
SELECT
  CAST(9100000000 + id AS BIGINT) AS person_id,
  sex,
  CAST(
    CASE age_group
      WHEN '<50' THEN 35 + pmod(id * 19, 15)
      WHEN '50-64' THEN 50 + pmod(id * 19, 15)
      WHEN '65-74' THEN 65 + pmod(id * 19, 10)
      ELSE 75 + pmod(id * 19, 16)
    END AS INT
  ) AS age_at_index,
  age_group,
  histology,
  smoking_status,
  'IV' AS stage_at_dx,
  true AS is_advanced,
  CAST(ecog_ps AS INT) AS ecog_ps,
  pdl1_tps,
  primary_driver,
  primary_driver = 'EGFR' AS egfr_pos,
  primary_driver = 'ALK' AS alk_pos,
  primary_driver = 'KRAS' AS kras_pos,
  date_add(DATE'2021-01-01', CAST(pmod(id * 29, 1095) AS INT)) AS index_date,
  CASE WHEN event_flag = 1 THEN 'Deceased' ELSE 'Alive' END AS vital_status,
  CAST(event_flag AS INT) AS event_flag,
  os_months_observed,
  CAST(ecog_median_os AS DECIMAL(10,1)) AS median_os_months_assumed,
  first_line_regimen,
  first_line_class,
  date_add(date_add(DATE'2021-01-01', CAST(pmod(id * 29, 1095) AS INT)), CAST(14 + pmod(id * 31, 32) AS INT)) AS first_line_start,
  CAST(CASE WHEN pmod(id * 41, 49915) < 32022 THEN 1 ELSE 2 END AS BIGINT) AS n_treatment_lines,
  ROUND(total_cost_of_care, 2) AS total_cost_of_care,
  ROUND(total_cost_of_care * pharmacy_share, 2) AS pharmacy_cost,
  ROUND(total_cost_of_care * (1.0D - pharmacy_share), 2) AS medical_cost,
  ROUND(pharmacy_share * 100.0D, 2) AS pct_cost_pharmacy,
  'synthetic_nsclc_rwe_v1' AS _source,
  current_timestamp() AS _gold_loaded_at,
  'vault-genie-2026.09' AS _pipeline_version
FROM costed;

ALTER TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master ALTER COLUMN person_id COMMENT 'Synthetic patient identifier; not a real patient or source-system ID';
ALTER TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master ALTER COLUMN ecog_ps COMMENT 'ECOG performance status from 0 (fully active) through 3 (limited self-care)';
ALTER TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master ALTER COLUMN os_months_observed COMMENT 'Synthetic observed overall survival in months';
ALTER TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master ALTER COLUMN event_flag COMMENT '1 when the synthetic survival event was observed and 0 when censored';
ALTER TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master ALTER COLUMN total_cost_of_care COMMENT 'Synthetic total medical and pharmacy cost of care in US dollars';
ALTER TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master ALTER COLUMN pharmacy_cost COMMENT 'Synthetic pharmacy portion of total cost of care in US dollars';
ALTER TABLE af_vault_genie_demo.nsclc_rwe.gold_patient_master ALTER COLUMN medical_cost COMMENT 'Synthetic medical portion of total cost of care in US dollars';

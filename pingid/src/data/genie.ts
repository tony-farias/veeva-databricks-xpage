export type GenieAnswer = {
  question: string;
  answer: string;
  sources: string[];
};

export const repPrompts: GenieAnswer[] = [
  {
    question: "How many suspect HFpEF patients are in this practice, and what's the constellation profile?",
    answer:
      "14 suspect ATTR-CM patients in Mid-Atlantic Cardiology Associates. Cohort: avg age 76 · all show low-voltage ECG · 3 have a carpal tunnel surgery history in the last 18 months · all carry HFpEF with relative wall thickness > 0.6. One new PYP scan was ordered at this practice last week. Counts are HCP-aggregate and de-identified per k-anonymity ≥ 11.",
    sources: ["Suspect-Patient Model v3.2", "Open Claims (Komodo)", "EHR FM extraction (Mosaic AI)"],
  },
  {
    question: "Has this HCP been to a competitor advisory board?",
    answer:
      "Yes. Open Payments shows $8,400 from Pfizer (advisory + speaker honoraria, +18% YoY) and $2,100 from BridgeBio (consulting, new this year) in the last 12 months. No Alnylam payments on record. Pfizer engagement clusters around 3 events: a January advisory dinner in DC, a March speaker program in Baltimore, and a virtual case-review in May.",
    sources: ["CMS Open Payments (Sunshine Act)"],
  },
  {
    question: "Which practices in my territory have the highest suspect-patient density?",
    answer:
      "Top 3 practices in DC / MD / N. VA by suspect-patient density: 1) Mid-Atlantic Cardiology Associates — 14, 2) Bethesda Heart and Vascular — 11, 3) Capital Cardiovascular Specialists — masked (N < 11, k-anonymity suppression). Two additional practices fall below the threshold.",
    sources: ["Suspect-Patient Model v3.2 (HCP rollup)"],
  },
  {
    question: "When was the last time a rep from another manufacturer visited this practice?",
    answer:
      "Cannot answer — competitor field activity isn't a captured signal in any source we ingest. Closest proxy: Open Payments cadence (3 Pfizer events in 12 months suggests a sustained cardiology rep relationship).",
    sources: ["No direct source · Open Payments proxy"],
  },
];

export const mslPrompts: GenieAnswer[] = [
  {
    question: "Summarize this KOL's publications in the last 24 months.",
    answer:
      "Dr. Chen has 4 first-author publications in the last 24 months, all in cardiac amyloidosis. Themes: diagnostic delay in V122I carriers, echo strain pattern correlations, and PYP scan workflow optimization. Two co-authors recur frequently: Dr. Mathew Maurer (Columbia) and Dr. Ahmad Masri (OHSU). Citation velocity is +42% YoY.",
    sources: ["PubMed", "Google Scholar (verified)", "HFSA / ACC abstracts"],
  },
  {
    question: "What clinical questions has this KOL raised before?",
    answer:
      "Across 4 prior MSL interactions and 2 advisory board contributions, Dr. Chen has consistently raised: (1) long-term safety of stabilizers in V122I carriers, (2) screening pathway evidence for asymptomatic TTR variant carriers, and (3) sequencing or combination of stabilizers with silencers. The same questions appear in the Q&A of her HFSA 2026 abstract presentation.",
    sources: ["MSL Interaction History (Vault CRM Medical)", "Adv. Board Insights"],
  },
  {
    question: "Who are this KOL's frequent co-authors?",
    answer:
      "Top recurring co-authors over last 36 months: Dr. Mathew Maurer (Columbia), Dr. Ahmad Masri (OHSU), Dr. Daniel Judge (MUSC). Maurer and Judge are also in your KOL database. Masri is not yet profiled — flagged for MSL follow-up.",
    sources: ["PubMed co-author graph"],
  },
  {
    question: "What active trials is this PI running and what's the enrollment status?",
    answer:
      "Two active roles: HELIOS-B (sub-investigator, enrollment closed, follow-up phase) and ACT-EARLY screening sub-study (PI, actively enrolling, 18 of 40 patients). No pending IIT submissions in the last 12 months.",
    sources: ["ClinicalTrials.gov", "FDA AdComm filings"],
  },
];

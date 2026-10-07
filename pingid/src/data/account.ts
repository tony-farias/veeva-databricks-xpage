export const account = {
  hcpName: "Sarah Chen, MD",
  specialty: "Cardiology",
  practice: "Mid-Atlantic Cardiology Associates",
  city: "Bethesda, MD",
  npi: "1234567890",
  rep: { name: "James Rodriguez", territory: "DC / MD / N. VA" },
  msl: { name: "Priya Patel, PharmD", region: "Mid-Atlantic Medical" },
  lastUpdated: "Refreshed 12 min ago · Databricks Lakehouse",
};

export const repData = {
  suspect: {
    count: 14,
    avgAge: 76,
    carpalTunnel: 3,
    lowVoltageECG: "All 14",
    newPYPLastWeek: 1,
    suppression: "k-anonymity ≥ 11 enforced",
  },
  competitorCoverage: [
    { brand: "Pfizer (Vyndaqel)", spend: "$8,400", trend: "+18% YoY", note: "Advisory + speaker honoraria" },
    { brand: "BridgeBio (Attruby)", spend: "$2,100", trend: "new this year", note: "Consulting" },
    { brand: "Alnylam (Amvuttra)", spend: "$0", trend: "—", note: "No payments on record" },
  ],
  practice: {
    coeAffiliation: "Mid-Atlantic Cardiac Amyloidosis Center (regional CoE)",
    pypCapable: true,
    cardiologists: 3,
    nextAvailablePYP: "8 days",
  },
  preCallBrief: {
    lastInteraction: "March 14 · Discussed PYP referral pathway · Left HFSA reprint",
    suggestedTopics: [
      "Carpal tunnel surgery as red flag — 3 in this practice",
      "PYP capacity update for MD/VA region",
      "New constellation cohort identified since last visit",
    ],
  },
  suggestedContent: [
    "ATTR-CM diagnostic algorithm reprint (Approved Email)",
    "PYP capacity in MD/VA — 1-pager (Approved Email)",
  ],
};

export const mslData = {
  sinceLastTouch: {
    timeFrame: "Since March 2026",
    events: [
      "Published 2 first-author abstracts at HFSA 2026",
      "Joined HELIOS-B as sub-investigator",
      "Presented at the Mid-Atlantic Cardiomyopathy Symposium (April)",
    ],
  },
  scientificFootprint: {
    pubs12mo: 4,
    activeTrials: ["HELIOS-B (sub-I)", "ACT-EARLY screening sub-study (PI)"],
    abstracts: ["HFSA 2026 (×2)", "ACC 2026"],
    coAuthors: ["Mathew Maurer, MD (Columbia)", "Ahmad Masri, MD (OHSU)"],
  },
  emergence: {
    rating: "Rising",
    citationVelocity: "+42% YoY",
    influence: "2nd-tier in HF · rising in cardiac amyloidosis",
  },
  topics: [
    "Long-term safety in V122I carriers",
    "Screening pathway evidence for asymptomatic gene carriers",
    "Sequencing of stabilizers + silencers",
  ],
  suggestedContent: [
    "ATTR-ACT 5-year extension data (publication)",
    "ATTR-CM diagnostic pathway slide deck (Approved Email Medical)",
    "V122I carrier screening — peer-reviewed reprint",
  ],
};

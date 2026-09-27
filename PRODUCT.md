# Product context: Vault CRM Clinical Genie

## Product

Vault CRM Clinical Genie is a headless Databricks Genie experience embedded in a Veeva Vault CRM X-Page. It gives clinical and field-medical users governed natural-language analytics without leaving their iPad workflow.

## Users

- Medical-science, HEOR, and clinical users working in Vault CRM on iPad.
- Data stewards and administrators who need Unity Catalog permissions, row filters, masks, and audit attribution to remain attached to the individual user.
- Demonstrators who need a credible clinical analytics workflow that is immediately understandable in a customer meeting.

## Core jobs

- Ask plain-language questions about a synthetic NSCLC real-world-evidence cohort.
- Review concise answers, generated SQL, query results, and Genie-generated visualizations.
- Run deeper Agent/Research analysis without switching applications.
- Understand which Veeva/Entra identity is being used and whether the secure session is active.

## Product personality

Precise, calm, clinical, and trustworthy. The application should feel like Genie belongs inside Vault CRM, not like a separate dashboard or an experimental chatbot.

## Experience principles

1. Conversation first: the answer and chart are the primary objects; application chrome recedes.
2. Governed by default: per-user authorization is visible but never visually dominant.
3. Evidence alongside insight: every visualization has a readable table fallback and generated SQL is one disclosure away.
4. Touch ready: controls are comfortably tappable on iPad and remain usable in compact X-Page containers.
5. Honest states: loading, empty, expired, and authorization failures explain what happened and what the user can do next.

## Anti-references

- Generic SaaS card dashboards.
- Glassmorphism and decorative gradients.
- Teal-heavy enterprise styling unrelated to Databricks Genie.
- Dense developer consoles presented to clinical users.
- Decorative animation that competes with analysis.

## Accessibility and privacy

- Target WCAG 2.2 AA contrast and visible keyboard focus.
- Respect reduced-motion preferences.
- Preserve chart/table equivalence and descriptive visualization alt text.
- Never expose Databricks access tokens in the X-Page; retain only the short-lived encrypted broker session in memory.
- Use disclosed synthetic patient data only.

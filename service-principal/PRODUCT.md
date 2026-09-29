# Product context: Vault CRM Clinical Genie, shared identity

Register: product

## Product

This is an independent headless Databricks Genie Agent experience for Veeva Vault CRM X-Pages. Veeva authenticates the human user, while every Databricks request runs through one fixed workspace service principal.

## Users

- Medical-science, HEOR, and clinical users working in Vault CRM on iPad.
- Customers who prefer a centrally curated shared data boundary over per-user Databricks provisioning.
- Administrators comparing shared service-principal authorization with user-level federation.

## Core jobs

- Ask plain-language questions about a synthetic NSCLC real-world-evidence cohort.
- Review concise answers, generated SQL, query results, and visualizations.
- Run deeper Agent mode analysis without leaving Vault CRM.
- Understand that Databricks authorization is shared while the Veeva actor is retained in application audit logs.

## Product personality

Precise, calm, clinical, and candid. The interface should feel native to Genie while making the shared identity boundary unmistakable.

## Experience principles

1. Conversation first: answers and evidence remain primary.
2. Honest shared authorization: never imply that Databricks row filters or audit attribution apply to the Veeva user.
3. Evidence alongside insight: every visualization retains a readable table fallback.
4. Touch ready: controls remain comfortable on iPad and compact X-Page surfaces.
5. Secure handoff: Databricks credentials never reach browser code.

## Accessibility and privacy

- Target WCAG 2.2 AA contrast and visible keyboard focus.
- Respect reduced-motion preferences.
- Preserve chart/table equivalence and descriptive visualization alt text.
- Never expose the service-principal secret or token in the X-Page.
- Do not log prompts or query results in the compensating application audit trail.
- Use disclosed synthetic patient data only.

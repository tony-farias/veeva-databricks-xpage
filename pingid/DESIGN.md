---
name: Vault CRM Clinical Genie
description: A calm shared-identity clinical analytics conversation that feels native to Databricks Genie.
colors:
  genie-coral: "#FF5F46"
  question-violet: "#7756E8"
  action-blue: "#2272E5"
  ink: "#1B1B1F"
  muted-ink: "#67666D"
  canvas: "#FFFFFF"
  quiet-surface: "#F7F7F8"
  border: "#E3E3E7"
  success: "#237B63"
  danger: "#A64035"
typography:
  headline:
    fontFamily: "Inter, SF Pro Text, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 2rem)"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, SF Pro Text, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, SF Pro Text, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: "6px"
  md: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  user-question:
    backgroundColor: "{colors.question-violet}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  composer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: Vault CRM Clinical Genie

## Overview

**Creative North Star: "The Clinical Notebook"**

The interface is a wide, quiet analytical notebook in which a question, explanation, chart, and evidence read as one continuous page. Databricks Genie is the primary visual reference; Veeva contributes context and identity without wrapping the conversation in a second dashboard.

The shared-identity version uses the same notebook language but explicitly labels both actors and the data scope: the signed-in user (the Ping token's `sub`), the fixed Databricks execution identity, and the identity claim that limits rows. Shared authorization is a semantic state, not a warning treatment or decorative theme.

The system is precise, calm, and trustworthy. It rejects the PRODUCT.md anti-references—generic SaaS card dashboards, glassmorphism and decorative gradients, teal-heavy enterprise styling unrelated to Databricks Genie, dense developer consoles presented to clinical users, and decorative animation that competes with analysis.

**Key Characteristics:**

- A centered transcript with generous white space and a restrained maximum width.
- Purple user prompts, coral Genie marks, and neutral assistant responses.
- Flat bordered result surfaces with chart/table equivalence.
- A persistent rounded composer designed for touch and keyboard use.
- Security and identity cues that remain available but visually secondary.

## Colors

The palette is neutral and clinical, with Genie coral and question violet used as rare semantic accents.

### Primary

- **Genie Coral**: reserved for the Genie spark and small product identifiers.
- **Question Violet**: used only for user-authored question bubbles and their direct active state.

### Secondary

- **Action Blue**: used for retry and send actions, links, and accessible focus treatment.

### Neutral

- **Clinical Ink**: primary headings, results, and chart labels.
- **Muted Ink**: supporting context, metadata, and timestamps.
- **Notebook Canvas**: the default workspace and result background.
- **Quiet Surface**: hover, selected-mode, and code backgrounds.
- **Hairline Border**: structural separation without simulated elevation.

### Named Rules

**The Rare Accent Rule.** Coral and violet together must occupy less than ten percent of the visible surface; their scarcity gives them meaning.

## Typography

**Display Font:** Inter with the system sans-serif stack
**Body Font:** Inter with the system sans-serif stack

**Character:** A single, highly legible product sans keeps the application close to Genie and native iPad conventions. Hierarchy comes from size, weight, and space rather than multiple font personalities.

### Hierarchy

- **Headline** (650, `clamp(1.5rem, 3vw, 2rem)`, 1.2): welcome and connection headings only.
- **Title** (600, 0.95rem, 1.35): space title and visualization titles.
- **Body** (400, 0.875rem, 1.6): assistant prose, limited to a comfortable reading width.
- **Label** (600, 0.75rem, 1.3): mode controls, metadata, table headings, and disclosures.

### Named Rules

**The Read-It-Once Rule.** Clinical answers use sentence case, short paragraphs, and clear numerical emphasis; uppercase is prohibited outside compact status labels.

## Elevation

The system is flat by default. White space, hairline borders, and quiet tonal surfaces establish hierarchy; a soft shadow appears only under the floating composer or a transient overlay.

### Shadow Vocabulary

- **Composer lift** (`0 8px 28px rgba(27, 27, 31, 0.10)`): separates the persistent composer from a scrolling transcript.

### Named Rules

**The Flat Evidence Rule.** Charts, tables, and SQL disclosures never use decorative shadows; evidence sits on the notebook page, not on floating cards.

## Components

### Buttons

- **Shape:** gently rounded rectangle (10px) with a minimum 44px touch target for primary actions.
- **Primary:** action blue, white text, and compact horizontal padding (10px 16px).
- **Hover / Focus:** a subtle tonal shift; focus always uses a visible blue ring.
- **Ghost:** transparent with a hairline border for secondary actions.

### Chips

- **Style:** low-contrast quiet surface, ink label, and compact pill geometry.
- **State:** selected mode uses a dark ink foreground and visible border; unselected modes remain neutral.

### Cards / Containers

- **Corner Style:** slight rounding (6–10px), not oversized dashboard cards.
- **Background:** notebook canvas or quiet surface.
- **Shadow Strategy:** none for analytical evidence.
- **Border:** a single 1px hairline.
- **Internal Padding:** 16px on compact containers and 24px on primary empty states.

### Inputs / Fields

- **Style:** white surface, ink text, 1px border, and 10px corners.
- **Focus:** action-blue border and visible outer ring.
- **Error / Disabled:** explicit text and reduced contrast without removing legibility.

### Navigation

The compact header exposes the space title, mode, identity, and conversation reset. Active state relies on text weight and a restrained surface, not a filled navigation bar.

### Genie Result

Assistant prose, a chart, its accessible data table, and the generated SQL disclosure are composed as one result. “Show code” remains close to the visualization. Failed PNG download never removes the table.

## Do's and Don'ts

### Do:

- **Do** keep the conversation centered with a maximum readable width near 960px.
- **Do** use the 1px Hairline Border to organize charts, tables, and disclosures.
- **Do** preserve at least 44px touch targets for primary iPad interactions.
- **Do** provide descriptive chart alt text and an adjacent accessible table fallback.
- **Do** respect reduced motion and keep state changes responsive rather than choreographed.

### Don't:

- **Don't** build generic SaaS card dashboards.
- **Don't** use glassmorphism and decorative gradients.
- **Don't** return to teal-heavy enterprise styling unrelated to Databricks Genie.
- **Don't** present dense developer consoles to clinical users; generated SQL belongs in a disclosure.
- **Don't** add decorative animation that competes with analysis.
- **Don't** place independent shadows around analytical evidence.

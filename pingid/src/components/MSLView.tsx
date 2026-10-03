import { mslData } from "../data/account";
import { mslPrompts } from "../data/genie";
import { GenieAskBox } from "./GenieAskBox";
import { Panel, HeroPanel } from "./Panel";

export function MSLView() {
  return (
    <div className="space-y-3">
      <GenieAskBox prompts={mslPrompts} variant="msl" />

      <HeroPanel
        eyebrow={`Since-Last-Touch Summary · ${mslData.sinceLastTouch.timeFrame}`}
        title="What's changed since you last engaged"
        variant="msl"
      >
        <ul className="space-y-1.5">
          {mslData.sinceLastTouch.events.map((e) => (
            <li key={e} className="flex gap-2">
              <span className="text-databricks-mint">●</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      </HeroPanel>

      <Panel title="Scientific Footprint" accent="mint">
        <div className="grid grid-cols-2 gap-2">
          <Row label="First-author pubs (12 mo)" value={String(mslData.scientificFootprint.pubs12mo)} />
          <Row label="Active trials" value={mslData.scientificFootprint.activeTrials.join(" · ")} />
          <Row label="Recent abstracts" value={mslData.scientificFootprint.abstracts.join(" · ")} />
          <Row label="Frequent co-authors" value={mslData.scientificFootprint.coAuthors.join(" · ")} />
        </div>
      </Panel>

      <Panel title="KOL Emergence Trajectory" badge={mslData.emergence.rating} accent="orange">
        <div className="grid grid-cols-3 gap-2">
          <Row label="Trajectory" value={mslData.emergence.rating} />
          <Row label="Citation velocity" value={mslData.emergence.citationVelocity} />
          <Row label="Influence position" value={mslData.emergence.influence} />
        </div>
      </Panel>

      <Panel title="Topics & Unmet Needs" accent="navy">
        <ul className="text-sm space-y-1">
          {mslData.topics.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="text-databricks-navy">●</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Suggested Content" accent="slate">
        <ul className="text-sm space-y-1.5">
          {mslData.suggestedContent.map((c) => (
            <li key={c} className="flex items-center justify-between bg-slate-50 rounded px-3 py-2">
              <span>{c}</span>
              <button className="text-[10px] uppercase tracking-wider text-databricks-mint font-semibold hover:underline">
                Share
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <div className="text-slate-500">{label}</div>
      <div className="text-databricks-navy font-medium">{value}</div>
    </div>
  );
}

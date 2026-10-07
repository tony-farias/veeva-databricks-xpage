import { useState } from "react";
import type { GenieAnswer } from "../data/genie";

export function GenieAskBox({
  prompts,
  variant,
}: {
  prompts: GenieAnswer[];
  variant: "rep" | "msl";
}) {
  const [active, setActive] = useState<GenieAnswer | null>(null);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");

  const accent = variant === "rep" ? "ring-databricks-orange/40" : "ring-databricks-navy/40";
  const dot = variant === "rep" ? "bg-databricks-orange" : "bg-databricks-mint";

  const ask = (q: GenieAnswer) => {
    setActive(null);
    setThinking(true);
    setInput(q.question);
    setTimeout(() => {
      setThinking(false);
      setActive(q);
    }, 750);
  };

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden`}>
      <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100">
        <div className={`w-2 h-2 rounded-full ${dot} animate-pulse`} />
        <span className="text-xs font-semibold text-databricks-navy uppercase tracking-wider">
          Databricks AI/BI Genie
        </span>
        <span className="text-[10px] text-slate-400">scoped to this account · governed by Unity Catalog</span>
      </div>
      <div className="p-4">
        <div className={`flex items-center gap-2 bg-slate-50 rounded-lg p-2 ring-1 ${accent}`}>
          <span className="text-slate-400 pl-1">▸</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about this account…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-400"
          />
          <button
            onClick={() => prompts[0] && ask(prompts[0])}
            className="text-xs px-3 py-1 rounded-md bg-databricks-navy text-white hover:bg-slate-800"
          >
            Ask
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {prompts.map((p) => (
            <button
              key={p.question}
              onClick={() => ask(p)}
              className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:border-databricks-orange hover:text-databricks-orange transition text-slate-600"
            >
              {p.question}
            </button>
          ))}
        </div>

        {(thinking || active) && (
          <div className="mt-4 bg-slate-50 rounded-lg p-4 border border-slate-200">
            {thinking ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span className="inline-block w-2 h-2 bg-databricks-orange rounded-full animate-bounce" />
                <span className="inline-block w-2 h-2 bg-databricks-orange rounded-full animate-bounce [animation-delay:120ms]" />
                <span className="inline-block w-2 h-2 bg-databricks-orange rounded-full animate-bounce [animation-delay:240ms]" />
                <span className="ml-2">Genie is querying the lakehouse…</span>
              </div>
            ) : active ? (
              <>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1 font-semibold">
                  Answer
                </div>
                <div className="text-sm text-databricks-navy leading-relaxed">{active.answer}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {active.sources.map((s) => (
                    <span
                      key={s}
                      className="text-[10px] bg-white border border-slate-200 text-slate-500 px-2 py-0.5 rounded"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

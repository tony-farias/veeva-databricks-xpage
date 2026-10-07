import type { ReactNode } from "react";

export function Panel({
  title,
  badge,
  children,
  accent = "slate",
}: {
  title: string;
  badge?: string;
  children: ReactNode;
  accent?: "slate" | "orange" | "mint" | "navy";
}) {
  const accents: Record<string, string> = {
    slate: "border-l-databricks-slate",
    orange: "border-l-databricks-orange",
    mint: "border-l-databricks-mint",
    navy: "border-l-databricks-navy",
  };
  return (
    <div className={`bg-white rounded-xl border border-slate-200 ${accents[accent]} border-l-4 p-4 shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{title}</h3>
        {badge && (
          <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
            {badge}
          </span>
        )}
      </div>
      <div className="text-sm text-databricks-navy">{children}</div>
    </div>
  );
}

export function HeroPanel({
  eyebrow,
  title,
  children,
  variant = "rep",
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  variant?: "rep" | "msl";
}) {
  const bg =
    variant === "rep"
      ? "bg-gradient-to-br from-databricks-orange to-orange-600 text-white"
      : "bg-gradient-to-br from-databricks-navy to-databricks-slate text-white";
  return (
    <div className={`${bg} rounded-xl p-5 shadow-md`}>
      <div className="text-[11px] uppercase tracking-wider opacity-80 font-semibold mb-1">{eyebrow}</div>
      <div className="text-lg font-semibold leading-snug mb-3">{title}</div>
      <div className="text-sm leading-relaxed opacity-95">{children}</div>
    </div>
  );
}

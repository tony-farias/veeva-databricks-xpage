import type { ReactNode } from "react";
import { account } from "../data/account";

export function VaultShell({
  role,
  children,
}: {
  role: "rep" | "msl";
  children: ReactNode;
}) {
  const personLabel = role === "rep" ? account.rep.name : account.msl.name;
  const territoryLabel = role === "rep" ? account.rep.territory : account.msl.region;
  const editionLabel = role === "rep" ? "Vault CRM" : "Vault CRM Medical";
  const editionColor = role === "rep" ? "bg-veeva-blue" : "bg-databricks-navy";

  return (
    <div className="flex flex-col h-full">
      <div className={`${editionColor} text-white px-4 py-2 flex items-center gap-3 text-xs`}>
        <div className="font-bold tracking-wide">VEEVA</div>
        <div className="opacity-80">{editionLabel}</div>
        <div className="ml-auto flex items-center gap-3 opacity-90">
          <span>{personLabel}</span>
          <span className="opacity-70">· {territoryLabel}</span>
          <span className="w-2 h-2 bg-databricks-mint rounded-full" />
        </div>
      </div>

      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-4 bg-slate-50/50">
        <div className="w-10 h-10 rounded-full bg-databricks-navy text-white flex items-center justify-center text-sm font-semibold">
          SC
        </div>
        <div>
          <div className="font-semibold text-databricks-navy">{account.hcpName}</div>
          <div className="text-[11px] text-slate-500">
            {account.specialty} · {account.practice} · {account.city} · NPI {account.npi}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {["Profile", "Interactions", "Content", role === "rep" ? "Suggestions" : "Inquiries"].map((t) => (
            <button
              key={t}
              className="text-xs px-3 py-1 rounded text-slate-500 hover:text-databricks-navy"
            >
              {t}
            </button>
          ))}
          <button className={`text-xs px-3 py-1 rounded font-semibold ${role === "rep" ? "bg-databricks-orange/10 text-databricks-orange" : "bg-databricks-navy/10 text-databricks-navy"}`}>
            Databricks Insights
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-slate-100/40">{children}</div>

      <div className="border-t border-slate-200 px-4 py-2 bg-white flex items-center gap-2 text-xs">
        {role === "rep" ? (
          <>
            <ActionBtn>Log Call</ActionBtn>
            <ActionBtn>Schedule</ActionBtn>
            <ActionBtn>Approved Email</ActionBtn>
            <ActionBtn>Sample</ActionBtn>
          </>
        ) : (
          <>
            <ActionBtn>Log Scientific Exchange</ActionBtn>
            <ActionBtn>Schedule</ActionBtn>
            <ActionBtn>Approved Email Medical</ActionBtn>
            <ActionBtn>Share Publication</ActionBtn>
          </>
        )}
        <div className="ml-auto text-[10px] text-slate-400 italic">{account.lastUpdated}</div>
      </div>
    </div>
  );
}

function ActionBtn({ children }: { children: ReactNode }) {
  return (
    <button className="px-3 py-1.5 border border-slate-200 rounded text-databricks-navy hover:bg-slate-50 font-medium">
      {children}
    </button>
  );
}

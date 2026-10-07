import type { ReactNode } from "react";

export function IpadFrame({ children }: { children: ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-[2.5rem] p-3 shadow-ipad" style={{ width: 980, height: 720 }}>
      <div className="bg-black rounded-[2rem] p-1.5 h-full">
        <div className="bg-white rounded-[1.5rem] h-full overflow-hidden flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}

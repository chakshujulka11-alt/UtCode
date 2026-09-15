import { UtcodeLogo } from "./UtcodeLogo";
import { APP_VERSION } from "../../shared/constants";

/**
 * Full stacked brand mark: hexagon+spark, then the lowercase wordmark with
 * version, centered, 20px gap — for About, splash-like surfaces and empty states.
 */
export function UtcodeBrand({ logoSize = 96, version, className = "" }: { logoSize?: number; version?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <UtcodeLogo size={logoSize} />
      <div className="mt-5 text-2xl font-semibold tracking-tight text-[#e0e0e0]">
        utcode <span className="align-baseline text-base font-normal text-[#888888]">v{version || APP_VERSION}</span>
      </div>
    </div>
  );
}

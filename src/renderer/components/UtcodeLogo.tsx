export function UtcodeLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.875} viewBox="0 0 120 105" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Hexagon outline with rounded corners */}
      <path
        d="M30 5 L90 5 L115 52.5 L90 100 L30 100 L5 52.5 Z"
        stroke="#D97757"
        strokeWidth="3"
        strokeLinejoin="round"
        fill="none"
      />
      {/* 6-pointed spark (3 crossing lines) */}
      <line x1="60" y1="35" x2="60" y2="75" stroke="#D97757" strokeWidth="4" strokeLinecap="round" />
      <line x1="43" y1="40" x2="77" y2="70" stroke="#D97757" strokeWidth="4" strokeLinecap="round" />
      <line x1="77" y1="40" x2="43" y2="70" stroke="#D97757" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

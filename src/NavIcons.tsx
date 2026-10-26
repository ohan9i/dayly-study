import { useId, type ReactNode } from 'react';

// 주 메뉴 아이콘: 둥근 네모 면을 틈으로 갈라 낸 "나뉜 창" 모양
function SplitTile({ children }: { children: ReactNode }) {
  const id = `nav-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        <g fill="#000" stroke="#000" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </g>
      </mask>
      <rect x="4" y="4" width="16" height="16" rx="4.5" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}

export function TodayIcon() {
  return (
    <SplitTile>
      <path d="M2 15.6h20" fill="none" strokeWidth={1.4} />
      <path d="M8.5 13.4a3.5 3.5 0 0 1 7 0z" strokeWidth={0} />
    </SplitTile>
  );
}

export function CalendarIcon() {
  return (
    <SplitTile>
      <path d="M12 2v20M2 12h20" fill="none" strokeWidth={1.4} />
      <circle cx="16" cy="16" r="1.6" strokeWidth={0} />
    </SplitTile>
  );
}

export function FlowIcon() {
  return (
    <SplitTile>
      <path d="M2 15.5c3 0 4-5 7-5s3.5 4 6 4 3.5-2 7-3" fill="none" strokeWidth={1.4} />
    </SplitTile>
  );
}

export function SettingsIcon() {
  return (
    <SplitTile>
      <path d="M2 9.8h20M2 14.2h20" fill="none" strokeWidth={1.2} />
      <circle cx="15" cy="9.8" r="2.1" strokeWidth={0} />
      <circle cx="9" cy="14.2" r="2.1" strokeWidth={0} />
    </SplitTile>
  );
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Atmosphere } from './Atmosphere';
import './PlannerBackground.css';

// Decoration is fetched only once the book has opened, so readers who skip the
// entry never download the shader at all.
const LiquidChrome = lazy(() => import('./LiquidChrome'));

/** Mount the decorative GPU layer only after the book has opened. */
export default function PlannerBackground({
  atmosphere,
  paused,
}: {
  atmosphere: Atmosphere;
  paused: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const flow = root.current?.closest('.entry-flow');
    const sync = () => setEntered(flow?.getAttribute('data-entered') === 'true');
    const observer = new MutationObserver(sync);
    if (flow) observer.observe(flow, { attributes: true, attributeFilter: ['data-entered'] });
    sync();
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="planner-background" hidden={!entered} aria-hidden="true">
      {entered && (
        <Suspense fallback={null}>
          <LiquidChrome
            paused={paused}
            color={atmosphere === 'night' ? '#77736b' : '#b6afa3'}
            speed={0.11}
            amplitude={0.2}
            detail={5}
            thickness={1.55}
            frequencyX={3.2}
            frequencyY={1.5}
            depth={0.65}
            roughness={0.45}
            exposure={0.6}
            lightMode={false}
            interactive
            rippleStrength={0.8}
            rippleSize={1}
            intro={false}
            tilt={0.4}
            maxDevicePixelRatio={1}
          />
        </Suspense>
      )}
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { toSvg } from 'html-to-image';
import PaperCrumple from './PaperCrumple';
import './PaperTransition.css';

export type PaperFrame = {
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export async function capturePaper(element: HTMLElement): Promise<PaperFrame> {
  const rect = element.getBoundingClientRect();
  const top = Math.max(0, rect.top);
  const height = Math.min(innerHeight, rect.bottom) - top;
  if (rect.width < 1 || height < 40) throw new Error('Paper is outside the viewport');
  // Capture only the visible sheet, keeping long plans within the texture budget.
  // This image stays in memory; it is never uploaded or stored.
  const visible = (node: HTMLElement) => {
    if (!(node instanceof HTMLElement)) return true;
    if (node.classList.contains('completion-sparkles')) return false;
    const bounds = node.getBoundingClientRect();
    // Keep preceding rows: removing them would shift the visible text upward
    // when the user navigates from the middle of a scrolled plan.
    return !bounds.height || bounds.top < top + height;
  };
  const svg = await toSvg(element, {
    width: rect.width,
    height,
    skipFonts: true,
    filter: visible,
    includeStyleProperties: [
      'display',
      'position',
      'box-sizing',
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'padding',
      'margin',
      'border',
      'border-radius',
      'background',
      'color',
      'opacity',
      'overflow',
      'flex',
      'flex-direction',
      'flex-wrap',
      'align-items',
      'justify-content',
      'gap',
      'row-gap',
      'column-gap',
      'grid-template-columns',
      'grid-column',
      'grid-row',
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'line-height',
      'letter-spacing',
      'white-space',
      'text-align',
      'text-decoration',
      'text-overflow',
      'word-break',
      'overflow-wrap',
      'list-style',
      'vertical-align',
      'top',
      'right',
      'bottom',
      'left',
      'transform',
      'transform-origin',
      'box-shadow',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-dasharray',
      'stroke-dashoffset',
      'stroke-linecap',
      'stroke-linejoin',
      'visibility',
      'appearance',
      'object-fit',
      'content',
      'z-index',
    ],
    style: {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      transform: `translateY(-${top - rect.top}px)`,
      transformOrigin: 'top left',
      boxShadow: 'none',
      animation: 'none',
    },
  });
  // html-to-image deep-clones SVGs without resolving descendant styles. Resolve
  // progress rings and check icons in the detached snapshot, never in the live UI.
  const documentCopy = new DOMParser().parseFromString(
    decodeURIComponent(svg.split(',')[1]),
    'image/svg+xml',
  );
  const originals = Array.from(element.querySelectorAll('svg')).filter((node) => {
    let parent: Element | null = node;
    while (parent && parent !== element) {
      if (parent instanceof HTMLElement && !visible(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  });
  const copies = documentCopy.querySelector('foreignObject')?.querySelectorAll('svg');
  const svgProperties = [
    'fill',
    'stroke',
    'stroke-width',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'font-family',
    'font-size',
    'font-weight',
    'text-anchor',
    'dominant-baseline',
    'opacity',
  ];
  copies?.forEach((copy, index) => {
    const original = originals[index];
    if (!original) return;
    const nativeChildren = original.querySelectorAll('*');
    copy.querySelectorAll<SVGElement>('*').forEach((child, i) => {
      const nativeChild = nativeChildren[i];
      if (!nativeChild) return;
      const computed = getComputedStyle(nativeChild);
      svgProperties.forEach((name) =>
        child.style.setProperty(name, computed.getPropertyValue(name)),
      );
    });
  });
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(documentCopy))}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(rect.width * ratio);
  canvas.height = Math.ceil(height * ratio);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Snapshot canvas unavailable');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const src = canvas.toDataURL('image/png');
  return { src, left: rect.left, top, width: rect.width, height };
}

export default function PaperTransition({
  frame,
  onDone,
}: {
  frame: PaperFrame;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    // Rendering, context loss, background tabs, and missing WAAPI cannot block navigation.
    const timeout = setTimeout(() => done.current(), 1500);
    return () => clearTimeout(timeout);
  }, []);
  const reveal = () => {
    const element = ref.current;
    if (!element?.animate) return done.current();
    element.dataset.phase = 'crumpling';
    const animation = element.animate(
      [
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        { opacity: 0, transform: 'translate3d(28px, -36px, 0)' },
      ],
      { delay: 420, duration: 400, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' },
    );
    animation.finished.then(() => done.current()).catch(() => {});
  };
  return (
    <div
      ref={ref}
      className="planner-paper-transition"
      data-phase="preparing"
      aria-hidden="true"
      inert
      style={{
        left: frame.left - 24,
        top: frame.top - 24,
        width: frame.width + 48,
        height: frame.height + 48,
      }}
    >
      <PaperCrumple
        src={frame.src}
        alt=""
        width={frame.width}
        height={frame.height}
        sceneHeight={frame.height + 48}
        releaseBehavior="restore"
        crumpleAmount={0.85}
        crumpleDuration={0.55}
        releaseDuration={0.4}
        foldCount={6}
        foldSharpness={0.6}
        wrinkleDepth={0.65}
        creaseStrength={0.18}
        paperColor="#f4f0e8"
        paperTexture={0.08}
        detail={innerWidth < 700 ? 32 : 48}
        shadow={false}
        draggable={false}
        returnToOrigin
        autoCrumple
        onReady={reveal}
        onError={() => done.current()}
      />
    </div>
  );
}

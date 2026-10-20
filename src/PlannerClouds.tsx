import { useEffect, useRef, useState } from 'react';
import './PlannerClouds.css';

type Connection = EventTarget & { saveData?: boolean };
const media = `${import.meta.env.BASE_URL}media/`;

/** Decorative video only; no assets are requested until the book intro has ended. */
export default function PlannerClouds() {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [entered, setEntered] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const flow = root.current?.closest('.entry-flow');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const sync = () => {
      setEntered(flow?.getAttribute('data-entered') === 'true');
      setAnimate(!reduced.matches && !connection?.saveData);
      setVisible(!document.hidden);
    };
    const observer = new MutationObserver(sync);
    if (flow) observer.observe(flow, { attributes: true, attributeFilter: ['data-entered'] });
    reduced.addEventListener('change', sync);
    connection?.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      observer.disconnect();
      reduced.removeEventListener('change', sync);
      connection?.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  useEffect(() => {
    const player = video.current;
    if (!player) return;
    if (visible)
      void player.play().catch(() => {
        /* A poster remains when autoplay is unavailable. */
      });
    else player.pause();
    return () => player.pause();
  }, [entered, animate, visible, failed]);

  return (
    <div ref={root} className="planner-clouds" hidden={!entered} aria-hidden="true">
      {entered && (
        <img src={`${media}planner-clouds-poster.webp`} alt="" draggable={false} decoding="async" />
      )}
      {entered && animate && !failed && (
        <video
          ref={video}
          src={`${media}planner-clouds.mp4`}
          poster={`${media}planner-clouds-poster.webp`}
          autoPlay={visible}
          loop
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          disablePictureInPicture
          disableRemotePlayback
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

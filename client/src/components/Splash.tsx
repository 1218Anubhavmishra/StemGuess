import { useEffect, useRef, useState } from 'react';
import Brand from './Brand';

// How long the starting screen shows the header before it slides up, and how long the slide takes.
const HOLD_MS = 1400;
const MOVE_MS = 800;
// After the slide, each section's content floats in for this long (see .entering in styles.css).
const ENTER_MS = 900;
// The header starts this much bigger than it ends up on the screen.
const START_SCALE = 1.3;

/**
 * The starting screen: the app header alone on white, which then slides up onto the header of
 * whatever screen is open while the screen's content floats in. Shown once per page load.
 */
export default function Splash() {
  const [stage, setStage] = useState<'show' | 'move' | 'done'>('show');
  const header = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add('splashing');
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        // Slide onto the real header, wherever the open screen has it, shrinking on the way. The title
        // is measured (not the whole header block, which the screen stretches to its width) so the
        // header ends at exactly the real one's size and nothing snaps when the starting screen goes.
        const target = document.querySelector('main .brand-block .logo');
        const me = header.current;
        const mine = me?.querySelector('.logo');
        if (target && me && mine) {
          const from = mine.getBoundingClientRect();
          const to = target.getBoundingClientRect();
          // The header scales around its centre C (which scaling doesn't move). With the title's centre now
          // at L (at START_SCALE), it lands on the real title's centre T at the end scale when moved by
          // T - C - end * (L - C) / START_SCALE.
          const box = me.getBoundingClientRect();
          const end = (START_SCALE * to.width) / from.width;
          const [cx, cy] = [box.left + box.width / 2, box.top + box.height / 2];
          const [lx, ly] = [from.left + from.width / 2, from.top + from.height / 2];
          const [tx, ty] = [to.left + to.width / 2, to.top + to.height / 2];
          const dx = tx - cx - (end * (lx - cx)) / START_SCALE;
          const dy = ty - cy - (end * (ly - cy)) / START_SCALE;
          me.style.transform = `translate(${dx}px, ${dy}px) scale(${end})`;
        }
        setStage('move');
        timers.push(
          window.setTimeout(() => {
            document.body.classList.remove('splashing');
            document.body.classList.add('entering');
            setStage('done');
            timers.push(window.setTimeout(() => document.body.classList.remove('entering'), ENTER_MS));
          }, MOVE_MS),
        );
      }, HOLD_MS),
    );
    return () => {
      timers.forEach(clearTimeout);
      document.body.classList.remove('splashing', 'entering');
    };
  }, []);

  if (stage === 'done') return null;
  return (
    <div className={`splash ${stage}`} style={{ ['--move-ms' as string]: `${MOVE_MS}ms` }}>
      <div className="splash-header" ref={header} style={{ transform: `scale(${START_SCALE})` }}>
        <Brand />
      </div>
    </div>
  );
}

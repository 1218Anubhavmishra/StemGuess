import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Whether there's more to scroll to before (above / left) and after (below / right) what shows. */
type More = { above: boolean; below: boolean };
type Axis = 'y' | 'x';

/**
 * Scrolling without a scrollbar: a grey line above or below the scrolled box (with an arrow on it) shows
 * there's more to scroll to that way; with axis 'x', the lines are on its left and right. Give `ref`,
 * `className` and `onScroll` to the scrolling element, and put it with <ScrollArrows> inside an element with
 * `wrapClassName` (which draws the lines).
 */
export function useScrollHints<T extends HTMLElement>(axis: Axis = 'y') {
  const ref = useRef<T>(null);
  const [more, setMore] = useState<More>({ above: false, below: false });
  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const [at, size, total] =
      axis === 'x' ? [el.scrollLeft, el.clientWidth, el.scrollWidth] : [el.scrollTop, el.clientHeight, el.scrollHeight];
    const above = at > 1;
    const below = at + size < total - 1;
    setMore((m) => (m.above === above && m.below === below ? m : { above, below }));
  }, [axis]);
  // After every render: the content (e.g. a filtered song list) may have changed its size.
  useEffect(check);
  useEffect(() => {
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [check]);
  // A sideways box also scrolls with an ordinary (up / down) mouse wheel.
  useEffect(() => {
    const el = ref.current;
    if (axis !== 'x' || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      // At either end the page scrolls as usual.
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [axis]);
  /** Scrolls most of the box's height (or width) back (-1) or on (1). */
  const scrollBy = useCallback(
    (direction: 1 | -1) => {
      const el = ref.current;
      if (!el) return;
      if (axis === 'x') el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
      else el.scrollBy({ top: direction * el.clientHeight * 0.8, behavior: 'smooth' });
    },
    [axis],
  );
  const wrapClassName = `scroll-wrap${axis === 'x' ? ' x' : ''}${more.above ? ' more-above' : ''}${more.below ? ' more-below' : ''}`;
  return { ref, more, axis, className: 'scroll-lines', wrapClassName, onScroll: check, scrollBy };
}

/** The arrows on the scroll lines; each scrolls that way. `tiny` suits small boxes. */
export function ScrollArrows({
  more,
  scrollBy,
  tiny = false,
  axis = 'y',
}: {
  more: More;
  scrollBy: (direction: 1 | -1) => void;
  tiny?: boolean;
  axis?: Axis;
}) {
  const size = tiny ? ' tiny' : '';
  const [back, on] =
    axis === 'x'
      ? [
          { side: 'left', label: 'Scroll left', glyph: '◀' },
          { side: 'right', label: 'Scroll right', glyph: '▶' },
        ]
      : [
          { side: 'up', label: 'Scroll up', glyph: '▲' },
          { side: 'down', label: 'Scroll down', glyph: '▼' },
        ];
  return (
    <>
      {more.above && (
        <button className={`scroll-hint ${back.side}${size}`} aria-label={back.label} onClick={() => scrollBy(-1)}>
          {back.glyph}
        </button>
      )}
      {more.below && (
        <button className={`scroll-hint ${on.side}${size}`} aria-label={on.label} onClick={() => scrollBy(1)}>
          {on.glyph}
        </button>
      )}
    </>
  );
}

/** A list that scrolls with grey lines and arrows instead of a scrollbar. */
export function ScrollList({
  className = '',
  label,
  tiny = false,
  children,
}: {
  className?: string;
  label?: string;
  tiny?: boolean;
  children: ReactNode;
}) {
  const scroll = useScrollHints<HTMLUListElement>();
  return (
    <div className={scroll.wrapClassName}>
      <ul ref={scroll.ref} className={`${className} ${scroll.className}`} aria-label={label} onScroll={scroll.onScroll}>
        {children}
      </ul>
      <ScrollArrows more={scroll.more} scrollBy={scroll.scrollBy} tiny={tiny} />
    </div>
  );
}

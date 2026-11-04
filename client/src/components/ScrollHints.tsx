import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

type More = { above: boolean; below: boolean };

/**
 * Scrolling without a scrollbar: a grey line above or below the scrolled box (with an arrow on it) shows
 * there's more to scroll to that way. Give `ref`, `className` and `onScroll` to the scrolling element, and
 * put it with <ScrollArrows> inside an element with `wrapClassName` (which draws the lines).
 */
export function useScrollHints<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [more, setMore] = useState<More>({ above: false, below: false });
  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const above = el.scrollTop > 1;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setMore((m) => (m.above === above && m.below === below ? m : { above, below }));
  }, []);
  // After every render: the content (e.g. a filtered song list) may have changed its height.
  useEffect(check);
  useEffect(() => {
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [check]);
  /** Scrolls most of the box's height up (-1) or down (1). */
  const scrollBy = useCallback((direction: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ top: direction * el.clientHeight * 0.8, behavior: 'smooth' });
  }, []);
  const wrapClassName = `scroll-wrap${more.above ? ' more-above' : ''}${more.below ? ' more-below' : ''}`;
  return { ref, more, className: 'scroll-lines', wrapClassName, onScroll: check, scrollBy };
}

/** The arrows on the scroll lines; each scrolls that way. `tiny` suits small boxes. */
export function ScrollArrows({
  more,
  scrollBy,
  tiny = false,
}: {
  more: More;
  scrollBy: (direction: 1 | -1) => void;
  tiny?: boolean;
}) {
  const size = tiny ? ' tiny' : '';
  return (
    <>
      {more.above && (
        <button className={`scroll-hint up${size}`} aria-label="Scroll up" onClick={() => scrollBy(-1)}>
          ▲
        </button>
      )}
      {more.below && (
        <button className={`scroll-hint down${size}`} aria-label="Scroll down" onClick={() => scrollBy(1)}>
          ▼
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

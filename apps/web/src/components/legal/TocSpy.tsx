'use client';

import { useEffect } from 'react';

/** Sets `aria-current="true"` on the table-of-contents links of the section currently in view. */
export function TocSpy({ ids }: { ids: readonly string[] }): null {
  const key = ids.join(',');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const sectionIds = key.split(',');
    const mark = (id: string): void => {
      document.querySelectorAll<HTMLAnchorElement>('[data-toc]').forEach((link) => {
        if (link.dataset.toc === id) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first !== undefined) mark(first.target.id);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    sectionIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element !== null) observer.observe(element);
    });
    return () => {
      observer.disconnect();
    };
  }, [key]);
  return null;
}

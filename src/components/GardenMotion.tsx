import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** 首页动效不接管导航；卸载和媒体条件变化时一并回收。 */
export default function GardenMotion() {
  useGSAP(() => {
    const garden = document.querySelector<HTMLElement>('[data-garden]');
    if (!garden) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncState = () => { garden.dataset.motionState = preference.matches ? 'static' : 'active'; };
    syncState();
    preference.addEventListener('change', syncState);
    const media = gsap.matchMedia();
    media.add({
      motion: '(prefers-reduced-motion: no-preference)',
      desktop: '(min-width: 1024px)',
      pointer: '(hover: hover) and (pointer: fine)'
    }, (context) => {
      const { motion, desktop, pointer } = context.conditions ?? {};
      if (!motion) return;
      const removers: Array<() => void> = [];
      // Transform the HTML wrapper, not each SVG leaf on every scroll frame.
      const art = garden.querySelector<HTMLElement>('.growth-art');
      if (art && desktop && pointer) {
        gsap.to(art, { y: -24, scale: .97, ease: 'none',
          scrollTrigger: { trigger: garden.querySelector('.folio-hero'), start: 'top top', end: 'bottom top', scrub: .35 } });
      }
      const words = garden.querySelectorAll('[data-word-reveal] span');
      if (words.length) gsap.fromTo(words, { opacity: .35 }, {
        opacity: 1, duration: .45, stagger: { amount: .3 }, ease: 'power2.out',
        scrollTrigger: { trigger: garden.querySelector('[data-word-reveal]'), start: 'top 90%', once: true }
      });
      if (desktop && pointer) {
        let activeReset: (() => void) | undefined;
        garden.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((element) => {
          const xTo = gsap.quickTo(element, 'x', { duration: .28, ease: 'power3.out' });
          const yTo = gsap.quickTo(element, 'y', { duration: .28, ease: 'power3.out' });
          let center: { x: number; y: number } | undefined;
          const enter = () => {
            const bounds = element.getBoundingClientRect();
            center = {
              x: bounds.left + bounds.width / 2 - Number(gsap.getProperty(element, 'x')),
              y: bounds.top + bounds.height / 2 - Number(gsap.getProperty(element, 'y'))
            };
            activeReset = reset;
          };
          const move = (event: PointerEvent) => {
            if (!center) return;
            xTo(gsap.utils.clamp(-5, 5, (event.clientX - center.x) * .1));
            yTo(gsap.utils.clamp(-3, 3, (event.clientY - center.y) * .1));
          };
          const reset = () => {
            center = undefined;
            xTo(0); yTo(0);
            if (activeReset === reset) activeReset = undefined;
          };
          element.addEventListener('pointerenter', enter);
          element.addEventListener('pointermove', move);
          element.addEventListener('pointerleave', reset);
          element.addEventListener('blur', reset);
          removers.push(() => {
            element.removeEventListener('pointerenter', enter);
            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerleave', reset);
            element.removeEventListener('blur', reset);
          });
        });
        const resetPointer = () => activeReset?.();
        window.addEventListener('scroll', resetPointer, { passive: true });
        removers.push(() => window.removeEventListener('scroll', resetPointer));
      }
      // ScrollTrigger already refreshes on load/resize; coalesce late image loads.
      let refreshFrame = 0;
      const refresh = () => {
        if (!refreshFrame) refreshFrame = requestAnimationFrame(() => {
          refreshFrame = 0;
          ScrollTrigger.refresh();
        });
      };
      garden.querySelectorAll('img').forEach(image => {
        if (!image.complete) {
          image.addEventListener('load', refresh, { once: true });
          removers.push(() => image.removeEventListener('load', refresh));
        }
      });
      return () => {
        cancelAnimationFrame(refreshFrame);
        removers.forEach(remove => remove());
      };
    });
    return () => {
      media.revert();
      preference.removeEventListener('change', syncState);
      delete garden.dataset.motionState;
    };
  }, []);
  return null;
}

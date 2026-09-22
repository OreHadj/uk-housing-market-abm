import { useEffect, useRef } from 'react';
import { init, type ECharts, type EChartsOption } from 'echarts';

/** Keep legend changes separate from data updates so toggling a run does not reset the chart. */
export function Report2MarketChart({ option, showSelected, showBaseline }: {
  option: EChartsOption;
  showSelected: boolean;
  showBaseline: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = init(container);
    instanceRef.current = instance;
    let resizeFrame = 0;
    const resize = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0
        && (instance.getWidth() !== container.clientWidth || instance.getHeight() !== container.clientHeight)) {
        instance.resize({ animation: { duration: 0 } });
      }
    };
    const scheduleResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(container);
    window.addEventListener('resize', scheduleResize);
    window.addEventListener('beforeprint', resize);
    window.addEventListener('afterprint', resize);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener('resize', scheduleResize);
      window.removeEventListener('beforeprint', resize);
      window.removeEventListener('afterprint', resize);
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    instance.setOption({ legend: { selected: { 'Selected run': showSelected, Baseline: showBaseline } } }, { lazyUpdate: true });
    instance.dispatchAction({ type: 'hideTip' });
  }, [option, showSelected, showBaseline]);

  return <div ref={containerRef} className="r2-trend-chart" />;
}

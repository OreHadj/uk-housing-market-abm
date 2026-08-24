import { useEffect, useRef, type CSSProperties } from 'react';
import * as echarts from 'echarts';

interface EChartProps {
  option: echarts.EChartsOption;
  className?: string;
  style?: CSSProperties;
  onClick?: (params: unknown) => void;
  onLegendSelectionChange?: (selected: Record<string, boolean>) => void;
}

export function EChart({ option, className, style, onClick, onLegendSelectionChange }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const instance = echarts.init(containerRef.current);
    instanceRef.current = instance;
    instance.setOption(option);
    let resizeFrame = 0;
    const scheduleResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => instance.resize());
    };
    scheduleResize();

    const resizeHandler = () => scheduleResize();
    window.addEventListener('resize', resizeHandler);
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(containerRef.current);
    if (containerRef.current.parentElement) {
      observer.observe(containerRef.current.parentElement);
    }

    return () => {
      window.removeEventListener('resize', resizeHandler);
      window.cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) {
      return;
    }
    instance.setOption(option, true);
    const resizeFrame = window.requestAnimationFrame(() => instance.resize());
    return () => window.cancelAnimationFrame(resizeFrame);
  }, [option]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || !onClick) {
      return;
    }

    const clickHandler = (params: unknown) => {
      onClick(params);
    };
    instance.on('click', clickHandler);

    return () => {
      instance.off('click', clickHandler);
    };
  }, [onClick]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance || !onLegendSelectionChange) {
      return;
    }

    const legendHandler = (params: unknown) => {
      const selected =
        typeof params === 'object' && params !== null && 'selected' in params
          ? (params as { selected?: Record<string, boolean> }).selected
          : undefined;
      onLegendSelectionChange(selected ?? {});
    };
    instance.on('legendselectchanged', legendHandler);

    return () => {
      instance.off('legendselectchanged', legendHandler);
    };
  }, [onLegendSelectionChange]);

  return <div ref={containerRef} className={className ?? 'chart'} style={style} />;
}

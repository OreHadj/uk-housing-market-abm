import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface EChartProps {
  option: echarts.EChartsOption;
  className?: string;
  onClick?: (params: unknown) => void;
  onLegendSelectionChange?: (selected: Record<string, boolean>) => void;
}

export function EChart({ option, className, onClick, onLegendSelectionChange }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const instance = echarts.init(containerRef.current);
    instanceRef.current = instance;
    instance.setOption(option);
    instance.resize();

    const resizeHandler = () => instance.resize();
    window.addEventListener('resize', resizeHandler);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', resizeHandler);
      observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setOption(option, true);
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

  return <div ref={containerRef} className={className ?? 'chart'} />;
}

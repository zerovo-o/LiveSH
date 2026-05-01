import * as echarts from "echarts";
import { memo, useEffect, useRef } from "react";

type EChartProps = {
  option: echarts.EChartsOption;
  className?: string;
  onClick?: (params: echarts.ECElementEvent) => void;
};

const EChart = memo(function EChart({ option, className, onClick }: EChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption(option, true);
    if (onClick) chart.on("click", onClick);
    const resize = () => chart.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [onClick, option]);

  return <div ref={ref} className={className ?? "h-64 w-full"} />;
});

export default EChart;

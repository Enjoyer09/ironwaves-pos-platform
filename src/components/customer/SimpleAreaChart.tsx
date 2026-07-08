import React from 'react';

type Props = {
  data: Array<{ date: string; amount: number }>;
  primaryColor: string;
  safeLang: string;
};

export default function SimpleAreaChart({ data, primaryColor }: Props) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number } | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  if (!data || data.length === 0) return null;

  const width = 500;
  const height = 180;
  const paddingLeft = 35;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 25;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const amounts = data.map((d) => d.amount);
  const maxAmount = Math.max(...amounts, 1);
  const minAmount = 0;

  const points = data.map((d, index) => {
    const x = paddingLeft + (index / (data.length - 1 || 1)) * chartWidth;
    const y = paddingTop + chartHeight - ((d.amount - minAmount) / (maxAmount - minAmount)) * chartHeight;
    return { x, y, date: d.date, amount: d.amount };
  });

  let linePath = '';
  let areaPath = '';

  if (points.length > 0) {
    linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      linePath += ` L ${points[i].x} ${points[i].y}`;
    }
    areaPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;

    let closestIndex = 0;
    let minDiff = Infinity;
    points.forEach((p, idx) => {
      const diff = Math.abs(p.x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = idx;
      }
    });

    setHoveredIndex(closestIndex);
    const activePoint = points[closestIndex];
    setTooltipPos({
      x: activePoint.x,
      y: activePoint.y - 10,
    });
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltipPos(null);
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!svgRef.current || e.touches.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const svgX = (touchX / rect.width) * width;

    let closestIndex = 0;
    let minDiff = Infinity;
    points.forEach((p, idx) => {
      const diff = Math.abs(p.x - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = idx;
      }
    });

    setHoveredIndex(closestIndex);
    const activePoint = points[closestIndex];
    setTooltipPos({
      x: activePoint.x,
      y: activePoint.y - 10,
    });
  };

  const yTicks = [0, maxAmount / 2, maxAmount];

  return (
    <div className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseLeave}
      >
        <defs>
          <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity={0.4} />
            <stop offset="100%" stopColor={primaryColor} stopOpacity={0.0} />
          </linearGradient>
        </defs>

        {yTicks.map((tick, idx) => {
          const y = paddingTop + chartHeight - ((tick - minAmount) / (maxAmount - minAmount)) * chartHeight;
          return (
            <line
              key={idx}
              x1={paddingLeft}
              y1={y}
              x2={width - paddingRight}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="4 4"
            />
          );
        })}

        {yTicks.map((tick, idx) => {
          const y = paddingTop + chartHeight - ((tick - minAmount) / (maxAmount - minAmount)) * chartHeight;
          return (
            <text
              key={idx}
              x={paddingLeft - 8}
              y={y + 3}
              fill="rgba(255,255,255,0.35)"
              fontSize={10}
              textAnchor="end"
            >
              {tick.toFixed(0)}₼
            </text>
          );
        })}

        {points.map((p, idx) => {
          const isTick = idx === 0 || idx === points.length - 1 || (points.length > 2 && idx === Math.floor(points.length / 2));
          if (!isTick) return null;
          return (
            <g key={idx}>
              <text
                x={p.x}
                y={height - 5}
                fill="rgba(255,255,255,0.35)"
                fontSize={10}
                textAnchor="middle"
              >
                {p.date}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#chartAreaGrad)" />

        <path d={linePath} fill="none" stroke={primaryColor} strokeWidth={2.5} strokeLinecap="round" />

        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={p.x}
            cy={p.y}
            r={hoveredIndex === idx ? 5 : 3}
            fill="#0f172a"
            stroke={primaryColor}
            strokeWidth={hoveredIndex === idx ? 2.5 : 1.5}
            className="transition-all duration-150"
          />
        ))}

        {hoveredIndex !== null && tooltipPos && (
          <line
            x1={tooltipPos.x}
            y1={paddingTop}
            x2={tooltipPos.x}
            y2={paddingTop + chartHeight}
            stroke="rgba(255,255,255,0.15)"
            strokeDasharray="2 2"
            pointerEvents="none"
          />
        )}
      </svg>

      {hoveredIndex !== null && tooltipPos && (
        <div
          className="absolute z-10 rounded-xl border border-white/10 bg-slate-950/95 p-2 text-xs text-white shadow-xl pointer-events-none transition-all duration-100"
          style={{
            left: `${(tooltipPos.x / width) * 100}%`,
            top: `${(tooltipPos.y / height) * 100}%`,
            transform: 'translate(-50%, -115%)',
          }}
        >
          <div className="font-bold text-slate-400">{points[hoveredIndex].date}</div>
          <div className="mt-0.5 flex items-center gap-1 font-semibold text-white">
            <span style={{ color: primaryColor }}>●</span>
            {points[hoveredIndex].amount.toFixed(2)} ₼
          </div>
        </div>
      )}
    </div>
  );
}

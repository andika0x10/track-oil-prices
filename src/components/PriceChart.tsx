import { useEffect, useId, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(useGSAP, DrawSVGPlugin, ScrollTrigger);

export interface ChartPoint {
  time: number;
  value: number;
  lower?: number;
  upper?: number;
  forecast?: boolean;
  month?: string;
  scenario?: boolean;
  endMonth?: string;
}
interface Props {
  points: ChartPoint[];
  label: string;
  animationKey: string;
  selectedMonth?: string;
  onSelectMonth?: (month: string) => void;
  monthly?: boolean;
  annual?: boolean;
}
const money = (value: number) => `$${value.toFixed(2)}`;
export default function PriceChart({
  points,
  label,
  animationKey,
  selectedMonth,
  onSelectMonth,
  monthly,
  annual,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hovered, setHovered] = useState<number | null>(null);
  const description = useId();
  const clipId = useId().replace(/:/g, "");
  useEffect(() => setHovered(null), [animationKey]);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(240, entries[0].contentRect.width)),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          const path =
            ref.current?.querySelector<SVGPathElement>(".history-line");
          if (!points.length) return;
          const timeline = gsap.timeline({
            defaults: { ease: "power3.out" },
            ...(monthly
              ? {
                  scrollTrigger: {
                    trigger: ref.current,
                    start: "top 90%",
                    once: true,
                  },
                }
              : { delay: 0.7 }),
          });
          if (path && path.getTotalLength() > 0)
            timeline.from(
              path,
              {
                drawSVG: 0,
                duration: 0.65,
                clearProps: "strokeDasharray,strokeDashoffset",
              },
              0,
            );
          if (monthly) {
            timeline
              .from(
                ".forecast-clip",
                { scaleX: 0, svgOrigin: "0 0", duration: 0.7 },
                0.35,
              )
              .from(".forecast-band", { autoAlpha: 0, duration: 0.45 }, 0.7);
          }
          timeline.from(
            ".chart-endpoint",
            { scale: 0, transformOrigin: "center", duration: 0.35 },
            monthly ? 0.95 : 0.5,
          );
        },
        ref,
      );
      return () => mm.revert();
    },
    {
      scope: ref,
      dependencies: [animationKey, points.length > 0],
      revertOnUpdate: true,
    },
  );

  const height = 282,
    left = 3,
    right = width - 58,
    top = 22,
    bottom = height - 32;
  const low = points.length
    ? Math.min(...points.map((p) => p.lower ?? p.value))
    : 0;
  const high = points.length
    ? Math.max(...points.map((p) => p.upper ?? p.value))
    : 100;
  const spread = Math.max(high - low, high * 0.04, 1);
  const min = low - spread * 0.18,
    max = high + spread * 0.18;
  const firstTime = points[0]?.time ?? 0,
    lastTime = points.at(-1)?.time ?? 1;
  const x = (time: number) =>
    left +
    ((time - firstTime) / Math.max(lastTime - firstTime, 1)) * (right - left);
  const y = (value: number) =>
    bottom - ((value - min) / (max - min)) * (bottom - top);
  const historical = points.filter((p) => !p.forecast);
  const forecast = points.filter((p) => p.forecast);
  const forecastLine = forecast.length
    ? [...historical.slice(-1), ...forecast]
    : [];
  const path = (list: ChartPoint[], accessor = (p: ChartPoint) => p.value) =>
    list
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(p.time).toFixed(2)},${y(accessor(p)).toFixed(2)}`,
      )
      .join(" ");
  const bandPath = (rows: ChartPoint[]) =>
    rows.length
      ? `${path(rows, (p) => p.upper ?? p.value)} ${[...rows]
          .reverse()
          .map((p) => `L${x(p.time)},${y(p.lower ?? p.value)}`)
          .join(" ")} Z`
      : "";
  const statistical = forecastLine.filter((p) => !p.scenario);
  const scenarioRows = forecast.filter((p) => p.scenario);
  const scenarioLine = scenarioRows.length
    ? [...statistical.slice(-1), ...scenarioRows]
    : [];
  const selected = selectedMonth
    ? points.findIndex((p) => p.month === selectedMonth)
    : -1;
  const activeIndex = hovered ?? (selected >= 0 ? selected : null);
  const active = activeIndex !== null ? points[activeIndex] : undefined;
  const last = points.at(-1);
  const tickCount = width < 500 ? 3 : 5;
  const dateLabel = (time: number) =>
    new Intl.DateTimeFormat(
      "en",
      monthly
        ? annual
          ? { year: "numeric", timeZone: "UTC" }
          : { month: "short", year: "2-digit", timeZone: "UTC" }
        : { month: "short", day: "numeric", timeZone: "UTC" },
    ).format(time);
  const nearest = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const time =
      firstTime +
      Math.max(0, Math.min(1, (clientX - box.left - left) / (right - left))) *
        (lastTime - firstTime);
    return points.reduce(
      (best, p, i) =>
        Math.abs(p.time - time) < Math.abs(points[best].time - time) ? i : best,
      0,
    );
  };
  return (
    <div className="price-chart" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        aria-describedby={description}
        tabIndex={points.length ? 0 : -1}
        onPointerMove={(event) => {
          if (points.length) setHovered(nearest(event.clientX));
        }}
        onPointerLeave={() => setHovered(null)}
        onClick={(event) => {
          const point = points[nearest(event.clientX)];
          if (point?.month && point.forecast) onSelectMonth?.(point.month);
        }}
        onKeyDown={(event) => {
          if (
            !points.length ||
            !["ArrowLeft", "ArrowRight", "Enter"].includes(event.key)
          )
            return;
          event.preventDefault();
          if (event.key === "Enter" && active?.month && active.forecast)
            onSelectMonth?.(active.month);
          else
            setHovered((previous) =>
              Math.max(
                0,
                Math.min(
                  points.length - 1,
                  (previous ?? points.length - 1) +
                    (event.key === "ArrowRight" ? 1 : -1),
                ),
              ),
            );
        }}
        onBlur={() => setHovered(null)}
      >
        {[0, 1, 2, 3].map((i) => {
          const value = min + ((max - min) * i) / 3;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={right}
                y1={y(value)}
                y2={y(value)}
                className="chart-grid"
              />
              <text
                x={width - 2}
                y={y(value) + 4}
                textAnchor="end"
                className="chart-label"
              >
                {points.length ? value.toFixed(0) : ""}
              </text>
            </g>
          );
        })}
        {points.length > 0 && (
          <>
            {historical.length > 0 && !forecast.length && (
              <path
                d={`${path(historical)} L${x(historical.at(-1)!.time)},${bottom} L${left},${bottom} Z`}
                fill="#F7F8FA"
              />
            )}
            <path
              className="history-line"
              d={path(historical)}
              fill="none"
              stroke="#000"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {forecast.length > 0 && (
              <g className="forecast-region" clipPath={`url(#${clipId})`}>
                <defs>
                  <clipPath id={clipId}>
                    <rect
                      className="forecast-clip"
                      x="0"
                      y="0"
                      width={width}
                      height={height}
                    />
                  </clipPath>
                </defs>
                <path
                  className="forecast-band"
                  d={bandPath(statistical)}
                  fill="#2457E6"
                  fillOpacity="0.09"
                />
                <path
                  className="forecast-band"
                  d={bandPath(scenarioLine)}
                  fill="#2457E6"
                  fillOpacity="0.045"
                />
                {scenarioLine.length > 0 && (
                  <>
                    <path
                      d={path(scenarioLine, (p) => p.lower ?? p.value)}
                      stroke="#2457E6"
                      strokeOpacity="0.45"
                      fill="none"
                      strokeDasharray="2 5"
                    />
                    <path
                      d={path(scenarioLine, (p) => p.upper ?? p.value)}
                      stroke="#2457E6"
                      strokeOpacity="0.45"
                      fill="none"
                      strokeDasharray="2 5"
                    />
                    <line
                      x1={x(statistical.at(-1)!.time)}
                      x2={x(statistical.at(-1)!.time)}
                      y1={top}
                      y2={bottom}
                      stroke="#626B78"
                      strokeDasharray="2 4"
                    />
                    <text
                      x={x(statistical.at(-1)!.time) + 5}
                      y={top - 6}
                      className="chart-label"
                    >
                      Scenarios
                    </text>
                  </>
                )}
                <path
                  d={path(forecastLine)}
                  fill="none"
                  stroke="#2457E6"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  strokeLinejoin="round"
                />
                <line
                  x1={x(forecast[0].time)}
                  x2={x(forecast[0].time)}
                  y1={top}
                  y2={bottom}
                  stroke="#BBC9F5"
                  strokeDasharray="3 5"
                />
              </g>
            )}
            {last && (
              <g className="chart-endpoint">
                <circle
                  cx={x(last.time)}
                  cy={y(last.value)}
                  r="6"
                  fill="#2457E6"
                  fillOpacity="0.12"
                />
                <circle
                  cx={x(last.time)}
                  cy={y(last.value)}
                  r="3"
                  fill="#2457E6"
                />
              </g>
            )}
            {Array.from({ length: tickCount }, (_, i) => {
              const time =
                firstTime + ((lastTime - firstTime) * i) / (tickCount - 1);
              return (
                <text
                  key={i}
                  x={x(time)}
                  y={height - 4}
                  textAnchor={
                    i === 0 ? "start" : i === tickCount - 1 ? "end" : "middle"
                  }
                  className="chart-label"
                >
                  {dateLabel(time)}
                </text>
              );
            })}
            {active && (
              <g>
                <line
                  x1={x(active.time)}
                  x2={x(active.time)}
                  y1={top}
                  y2={bottom}
                  stroke="#A7B0C1"
                  strokeDasharray="3 4"
                />
                <circle
                  cx={x(active.time)}
                  cy={y(active.value)}
                  r="4"
                  fill={active.forecast ? "#2457E6" : "#000"}
                  stroke="white"
                  strokeWidth="2"
                />
              </g>
            )}
          </>
        )}
      </svg>
      <span id={description} className="sr-only">
        {points.length
          ? `${points.length} observations. Latest ${money(last!.value)}. Use left and right arrow keys to inspect values.${monthly ? " Press Enter on a projected month for details." : ""}`
          : "No price data is available yet."}
      </span>
      {active && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.max(4, Math.min(width - 175, x(active.time) - 80)),
            top: Math.max(0, Math.min(164, y(active.value) - 72)),
          }}
          aria-live="polite"
        >
          <span>
            {active.endMonth
              ? `${active.month} – ${active.endMonth}`
              : dateLabel(active.time)}
            {active.forecast
              ? active.scenario
                ? " · Base scenario"
                : " · Projection"
              : ""}
          </span>
          <strong>{money(active.value)}</strong>
          {active.lower !== undefined && (
            <small>
              {money(active.lower)}–{money(active.upper!)}{" "}
              {active.scenario ? "low–high scenarios" : "range"}
            </small>
          )}
        </div>
      )}
    </div>
  );
}

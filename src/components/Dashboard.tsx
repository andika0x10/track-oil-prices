import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { SplitText } from "gsap/SplitText";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Flip } from "gsap/Flip";
import PriceChart, { type ChartPoint } from "./PriceChart";
import ForecastMethodology from "./ForecastMethodology";
import { useMarket } from "../hooks/useMarket";
import { useOutlook } from "../hooks/useOutlook";
import { BROWSER_MODELS } from "../lib/forecast";
import {
  HORIZONS,
  type Horizon,
  type Outlook,
  type Projection,
} from "../lib/types";
import { upcomingMonths } from "../lib/data";
import { outlookPeriods } from "../lib/scenarios";
gsap.registerPlugin(useGSAP, SplitText, ScrollTrigger, Flip);
const money = (v?: number) =>
  v === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
const monthName = (m: string) =>
  new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(`${m}-01T00:00:00Z`),
  );
const fullMonth = (m: string) => `${monthName(m)} ${m.slice(0, 4)}`;
const dateTime = (d: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(d));
const horizonLabel = (h: number) => (h >= 12 ? `${h / 12}Y` : `${h}M`);
function Icon({
  name,
  size = 18,
}: {
  name: "down" | "refresh" | "close" | "plus" | "globe" | "calendar";
  size?: number;
}) {
  const paths = {
    down: "M12 4v16m-6-6 6 6 6-6",
    refresh:
      "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2",
    close: "m6 6 12 12M6 18 18 6",
    plus: "M12 5v14M5 12h14",
    globe: "M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
    calendar: "M5 5h14v15H5zM8 3v4m8-4v4M5 10h14m-10 4h2m2 0h2m-6 3h2",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "globe" && <circle cx="12" cy="12" r="9" />}
      <path d={paths[name]} />
    </svg>
  );
}
function Logo() {
  return (
    <svg
      width="30"
      height="32"
      viewBox="0 0 30 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 1.5C12 6 4 14 4 20a11 11 0 0 0 22 0C26 14 18 6 15 1.5Z"
        fill="currentColor"
      />
      <path
        d="M10 20a5 5 0 0 0 5 5"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
function AnimatedPrice({ value }: { value?: number }) {
  const element = useRef<HTMLSpanElement>(null),
    previous = useRef<number | undefined>(undefined);
  useGSAP(
    () => {
      if (value === undefined || !element.current) return;
      const target = element.current;
      if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        previous.current === undefined
      )
        target.textContent = value.toFixed(2);
      else {
        const counter = { value: previous.current };
        gsap.to(counter, {
          value,
          duration: 0.55,
          ease: "power2.out",
          onUpdate: () => {
            target.textContent = counter.value.toFixed(2);
          },
        });
      }
      previous.current = value;
    },
    { scope: element, dependencies: [value], revertOnUpdate: true },
  );
  return (
    <span ref={element} aria-hidden="true">
      {value === undefined ? "—" : value.toFixed(2)}
    </span>
  );
}
function MonthDetail({
  month,
  point,
  outlook,
  onClose,
}: {
  month: string;
  point?: Projection;
  outlook?: Outlook;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);
  const { contextSafe } = useGSAP(
    () => {
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        gsap.from(".detail-content", {
          y: 32,
          autoAlpha: 0,
          duration: 0.35,
          ease: "power3.out",
        });
    },
    { scope: dialog },
  );
  const close = contextSafe(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      onClose();
    else
      gsap.to(".detail-content", {
        y: 16,
        autoAlpha: 0,
        duration: 0.18,
        overwrite: "auto",
        onComplete: onClose,
      });
  });
  return (
    <dialog
      ref={dialog}
      className="month-dialog"
      aria-labelledby="month-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="detail-content">
        <div className="sheet-handle" />
        <div className="flex items-start justify-between gap-4">
          <span className="muted">Monthly benchmark outlook</span>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close month details"
            autoFocus
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="month-title">
          {point?.endMonth
            ? `${fullMonth(month)} – ${fullMonth(point.endMonth)}`
            : fullMonth(month)}
        </h2>
        <div className="detail-price">{money(point?.estimate)}</div>
        <p className="muted">
          {point?.endMonth ? "Annual average" : "Monthly average"} · nominal USD
          per barrel{point?.scenario ? " · Base scenario" : ""}
        </p>
        {point ? (
          <>
            <div className="range-track">
              <span style={{ left: `${Math.max(0, Math.min(100, (point.estimate - point.lower) / (point.upper - point.lower || 1) * 100))}%` }} />
            </div>
            <div className="range-endpoints">
              <div>
                <span>
                  {point.scenario ? "Low scenario" : "Lower projection"}
                </span>
                <strong>{money(point.lower)}</strong>
              </div>
              <div>
                <span>
                  {point.scenario ? "High scenario" : "Upper projection"}
                </span>
                <strong>{money(point.upper)}</strong>
              </div>
            </div>
            <p className="detail-note">
              {point.scenario
                ? "Assumption-based scenarios, not a prediction interval. USD inflation: 2% annually. Real price growth: low −2%, base 0%, high +2%. All paths compound monthly from the month-36 estimate."
                : point.endMonth
                  ? "Annual averages of monthly estimates and interval endpoints. These bounds are not a calibrated annual 80% interval."
                : outlook?.inference
                  ? "The model’s 10th–90th percentile range: a nominal 80% prediction interval. Its actual coverage on Brent has not yet been established."
                  : "An 80% prediction interval, calibrated against historical forecast errors. Actual prices may fall outside this range."}
            </p>
            <dl className="detail-meta">
              {point.scenario && outlook?.scenarios && (
                <div>
                  <dt>Scenario anchor</dt>
                  <dd>
                    {money(outlook.scenarios.anchor)} ·{" "}
                    {fullMonth(outlook.scenarios.anchorMonth)}
                  </dd>
                </div>
              )}
              <div>
                <dt>Model</dt>
                <dd>{point.model || outlook?.model.model}</dd>
              </div>
              <div>
                <dt>Last observed month</dt>
                <dd>{outlook && fullMonth(outlook.lastObservation)}</dd>
              </div>
              <div>
                <dt>Calculated</dt>
                <dd>{outlook && dateTime(outlook.generatedAt)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="detail-note">
            No estimate is available for this month yet. It will appear after a
            valid benchmark outlook is available.
          </p>
        )}
        <p className="detail-disclaimer">
          Europe Brent benchmark. Separate from the live Hyperliquid perpetual
          price.
        </p>
      </div>
    </dialog>
  );
}
export default function Dashboard() {
  const root = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState("1M");
  const {
    market,
    history,
    connection,
    marketError,
    historyError,
    loading,
    retry,
  } = useMarket(range);
  const [horizon, setHorizon] = useState<Horizon>(12);
  const [selectedMonth, setSelectedMonth] = useState<string>();
  const [calendarLimit, setCalendarLimit] = useState(12);
  const { outlook, loading: outlookLoading, error: outlookError, phase, progress,
    modelId, chooseModel, cached, retry: retryOutlook } = useOutlook();
  const [methodOpen, setMethodOpen] = useState(false),
    [now, setNow] = useState<Date>();
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          const split = SplitText.create("#market-title", {
            type: "words",
            mask: "words",
          });
          const mobile = window.matchMedia("(max-width: 767px)").matches;
          gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from(".site-header", { y: -12, autoAlpha: 0, duration: 0.45 }, 0)
            .from(
              split.words,
              {
                yPercent: 105,
                rotation: mobile ? 0 : 3,
                stagger: 0.085,
                duration: 0.7,
              },
              0.15,
            )
            .from(
              ".instrument-line, .market-heading .section-description",
              { autoAlpha: 0, y: 8, stagger: 0.1, duration: 0.5 },
              0.4,
            )
            .from(
              ".price-row",
              { y: mobile ? 12 : 26, autoAlpha: 0, duration: 0.7 },
              0.6,
            )
            .from(".market-bottom", { autoAlpha: 0, duration: 0.4 }, 1.1);
        },
        root,
      );
      return () => mm.revert();
    },
    { scope: root },
  );
  const { contextSafe } = useGSAP({ scope: root });
  const indicatorState = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const chooseHorizon = contextSafe((value: Horizon) => {
    if (value === horizon) return;
    indicatorState.current = Flip.getState(
      root.current!.querySelectorAll(".horizon-indicator"),
    );
    setSelectedMonth(undefined);
    setCalendarLimit(value >= 180 ? 10 : 12);
    setHorizon(value);
  });
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          if (indicatorState.current)
            Flip.from(indicatorState.current, {
              duration: 0.3,
              ease: "power3.inOut",
              prune: true,
            });
          if (root.current?.querySelector(".calendar-grid")) gsap.fromTo(
            ".calendar-grid",
            { autoAlpha: 0.4, y: 8 },
            { autoAlpha: 1, y: 0, duration: 0.3, overwrite: "auto" },
          );
          for (const group of gsap.utils.toArray<HTMLElement>(
            ".calendar-year",
            root.current!,
          )) {
            gsap.from(group.querySelectorAll(".month-cell"), {
              opacity: 0,
              y: 12,
              duration: 0.3,
              stagger: { amount: 0.15 },
              scrollTrigger: { trigger: group, start: "top 95%", once: true },
            });
          }
          ScrollTrigger.refresh();
        },
        root,
      );
      return () => mm.revert();
    },
    {
      scope: root,
      dependencies: [horizon, outlookLoading, calendarLimit],
      revertOnUpdate: true,
    },
  );
  const openMonth = useCallback((month: string) => setSelectedMonth(month), []);
  const toggleMethod = contextSafe(() => {
    if (
      methodOpen &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      gsap.to(".method-body", {
        autoAlpha: 0,
        y: -8,
        duration: 0.18,
        overwrite: "auto",
        onComplete: () => setMethodOpen(false),
      });
    } else setMethodOpen((v) => !v);
  });
  useGSAP(
    () => {
      if (
        methodOpen &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        gsap.from(".method-body", { y: 12, opacity: 0, duration: 0.35 });
    },
    { scope: root, dependencies: [methodOpen], revertOnUpdate: true },
  );
  const months = now ? upcomingMonths(horizon, now) : [];
  const annual = horizon >= 180;
  const visible = useMemo(
    () => (outlook && now ? outlookPeriods(outlook, horizon, now) : []),
    [outlook, horizon, now],
  );
  const forecastByMonth = new Map(visible.map((p) => [p.month, p]));
  const allCalendarMonths = annual
    ? now
      ? Array.from({ length: horizon / 12 }, (_, i) => months[i * 12])
      : []
    : months;
  const calendarMonths = allCalendarMonths.slice(0, calendarLimit);
  const years = [...new Set(calendarMonths.map((m) => m.slice(0, 4)))];
  const endpoint = visible.at(-1);
  const progressPercent = progress.total ? Math.min(100, Math.floor(progress.loaded / progress.total * 100)) : undefined;
  const phaseLabel = phase === "checking" ? "Checking the latest EIA data"
    : phase === "downloading" ? "Preparing your prediction model"
    : phase === "predicting" ? "Calculating the months ahead"
    : "The outlook is not available yet.";
  const livePoints: ChartPoint[] =
    history?.candles.map((c) => ({ time: c.time, value: c.close })) || [];
  const outlookPoints = useMemo<ChartPoint[]>(
    () =>
      !outlook
        ? []
        : [
            ...outlook.observations.slice(-12).map((r) => ({
              time: Date.parse(`${r.month}-01T00:00:00Z`),
              value: r.value,
              month: r.month,
            })),
            ...visible.map((p) => ({
              time: Date.parse(`${p.endMonth ?? p.month}-01T00:00:00Z`),
              value: p.estimate,
              lower: p.lower,
              upper: p.upper,
              forecast: true,
              month: p.month,
              scenario: p.scenario,
              endMonth: p.endMonth,
            })),
          ],
    [outlook, visible, now],
  );
  const isUp = (market?.change ?? 0) >= 0,
    firstDate = history?.candles[0]?.time;
  const statusLabel = {
    connecting: "Connecting",
    live: "Live updates",
    reconnecting: "Reconnecting",
    stale: "Updates delayed",
  }[connection];
  return (
    <div ref={root} className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header flex items-center justify-between">
        <a
          className="brand flex items-center gap-2.5"
          href="#"
          aria-label="Brent Outlook home"
        >
          <Logo />
          <span>
            brent<span className="brand-light">outlook</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation" className="flex items-center gap-7">
          <a href="#outlook">Outlook</a>
          <a href="#methodology" className="method-nav">
            Methodology
          </a>
          <span className="header-source">
            <Icon name="globe" size={15} /> Global energy
          </span>
        </nav>
      </header>
      <main id="main">
        <section aria-labelledby="market-title" className="market-section">
          <div className="market-heading flex flex-wrap items-start justify-between gap-5">
            <div>
              <div className="instrument-line">
                <span className="instrument-symbol">Br</span>
                <span>
                  Brent crude oil
                  <span className="instrument-type">Perpetual</span>
                </span>
              </div>
              <h1 id="market-title">The price of now.</h1>
              <p className="section-description">
                Live from Hyperliquid. A clear view of where Brent stands.
              </p>
            </div>
            <span className={`connection ${connection}`} role="status">
              <span className="status-dot" />
              {statusLabel}
            </span>
          </div>
          <div className="price-row flex flex-wrap items-end justify-between gap-6">
            <div>
              <div
                className="live-price"
                aria-label={
                  market
                    ? `Mark price ${money(market.price)} per barrel`
                    : "Loading mark price"
                }
              >
                <span className="currency-sign">$</span>
                <AnimatedPrice value={market?.price} />
                <span className="price-unit">/ barrel</span>
              </div>
              <div className="price-change-line">
                {market ? (
                  <>
                    <span
                      className={`price-change ${isUp ? "positive" : "negative"}`}
                    >
                      <span aria-hidden="true">{isUp ? "↗" : "↘"}</span>{" "}
                      {isUp ? "+" : ""}
                      {market.change.toFixed(2)}%
                    </span>
                    <span className="muted">
                      {money(Math.abs(market.price - market.previousDay))}{" "}
                      {isUp ? "higher" : "lower"} than 24h ago
                    </span>
                  </>
                ) : (
                  <span className="muted">Waiting for a market price</span>
                )}
              </div>
            </div>
            <div className="market-meta">
              <div>
                <span>24h volume</span>
                <strong>
                  {market
                    ? `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(market.volume)}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span>Source</span>
                <a
                  href="https://app.hyperliquid.xyz/trade/xyz:BRENTOIL"
                  target="_blank"
                  rel="noreferrer"
                >
                  Hyperliquid{" "}
                  <span className="external-icon" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </div>
            </div>
          </div>
          <div className="live-chart-wrap" aria-busy={loading}>
            <PriceChart
              points={livePoints}
              label="Brent perpetual historical closing prices"
              animationKey={range}
            />
            {!livePoints.length && (
              <div className="chart-empty compact">
                <span className="empty-orbit">
                  <Logo />
                </span>
                <p>
                  {loading
                    ? "Connecting to the market…"
                    : "Price history is unavailable"}
                </p>
                {!loading && (
                  <button className="text-button" onClick={retry}>
                    <Icon name="refresh" size={14} /> Try again
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="market-bottom flex flex-wrap items-center justify-between gap-4">
            <div
              className="segmented history-control"
              role="group"
              aria-label="Historical price range"
            >
              {["1D", "1W", "1M", "ALL"].map((v) => (
                <button
                  key={v}
                  aria-pressed={range === v}
                  onClick={() => setRange(v)}
                >
                  {v === "ALL" ? "All" : v}
                </button>
              ))}
            </div>
            <p className="update-note">
              {market
                ? `Mark price · ${dateTime(market.updatedAt)}`
                : "Mark price · xyz:BRENTOIL"}
            </p>
          </div>
          {(marketError || historyError) && (
            <p className="inline-message" role="status">
              {marketError || historyError}{" "}
              <button onClick={retry}>Retry</button>
            </p>
          )}
          {range === "ALL" && firstDate && (
            <p className="history-note">
              Available history begins{" "}
              {new Intl.DateTimeFormat("en", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              }).format(firstDate)}
              .
            </p>
          )}
        </section>
        <section
          id="outlook"
          className="outlook-section"
          aria-labelledby="outlook-title"
        >
          <div className="section-top flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="section-kicker">
                <span className="blue-line" /> EIA Brent benchmark
              </div>
              <h2 id="outlook-title">
                {annual ? "The years ahead." : "The months ahead."}
              </h2>
              <p className="section-description">
                {annual
                  ? "A longer perspective. One year at a time."
                  : "Monthly predictions, using the latest published Brent history."}
              </p>
            </div>
            <div className="horizon-groups">
              {[{ label: "Predictions", values: HORIZONS.filter((v) => v <= 36) },
                { label: "Long-range scenarios", values: HORIZONS.filter((v) => v > 36) }].map((group) => (
              <div className="horizon-group" key={group.label}>
                <span>{group.label}</span>
                <div className="segmented forecast-horizons" role="group" aria-label={group.label}>
              {group.values.map((v) => (
                <button
                  key={v}
                  aria-pressed={horizon === v}
                  onClick={() => chooseHorizon(v)}
                  aria-label={
                    v > 36
                      ? `${v / 12} year scenario`
                      : `${v} month projection`
                  }
                >
                  {horizon === v && (
                    <span
                      className="horizon-indicator"
                      data-flip-id="horizon-active"
                      aria-hidden="true"
                    />
                  )}
                  <span className="horizon-label">{horizonLabel(v)}</span>
                </button>
              ))}
                </div>
              </div>
              ))}
            </div>
          </div>
          <div className="forecast-toolbar">
            <div className="forecast-status" role="status" aria-live="polite">
              <span className={`forecast-status-dot ${outlookLoading ? "pending" : outlookError ? "delayed" : ""}`} />
              <span>{outlookLoading ? phaseLabel : outlookError ? (outlook ? "Previous prediction retained" : "Prediction unavailable")
                : `${outlook?.model.model}${cached ? " · Saved calculation" : " · Calculated in your browser"}`}
                {outlook && phase === "downloading" && progressPercent !== undefined ? ` (${progressPercent}%)` : ""}</span>
            </div>
            <button className="text-button" onClick={retryOutlook} disabled={outlookLoading}>
              <Icon name="refresh" size={14} /> {outlookLoading ? "Checking" : "Check latest data"}
            </button>
          </div>
          {outlook && endpoint && (
            <div className="outlook-summary">
              <div><span>{fullMonth(endpoint.endMonth ?? endpoint.month)} {endpoint.scenario ? "base scenario" : "estimate"}</span>
                <strong>{money(endpoint.estimate)}</strong></div>
              <div><span>{endpoint.scenario ? "Low–high scenarios" : "Model’s 80% range"}</span>
                <strong className="summary-range">{money(endpoint.lower)} – {money(endpoint.upper)}</strong></div>
              <div><span>Latest EIA observation</span><strong className="summary-date">{fullMonth(outlook.lastObservation)}</strong></div>
            </div>
          )}
          <div className="outlook-chart-wrap" aria-busy={outlookLoading}>
            <div className="outlook-chart-header">
              <span>
                {horizon > 36
                  ? `${annual ? "Annual" : "Monthly"} outlook & scenarios`
                  : horizon === 36
                    ? "Long-term projection"
                    : "Monthly price projection"}
              </span>
              <div className="chart-legend">
                <span>
                  <i className="legend-line" />
                  History
                </span>
                <span>
                  <i className="legend-projection" />
                  Projection
                </span>
                {horizon > 36 && <span><i className="legend-scenario" />Scenarios</span>}
                <span>
                  <i className="legend-range" />
                  {horizon > 36 ? "Model / scenario range" : "Model’s 80% range"}
                </span>
              </div>
            </div>
            <PriceChart
              points={outlookPoints}
              label={`${annual ? "Annual" : "Monthly"} Brent benchmark outlook${horizon > 36 ? " and assumption-based scenarios" : " with an 80 percent prediction interval"}`}
              animationKey={`outlook-${horizon}`}
              selectedMonth={selectedMonth}
              onSelectMonth={openMonth}
              monthly
              annual={annual}
            />
            {!outlook && (
              <div className="chart-empty outlook-empty">
                <span className="outlook-empty-icon">
                  <Icon name="calendar" size={25} />
                </span>
                <h3>
                  {phaseLabel}
                </h3>
                <p>
                  {outlookLoading
                    ? phase === "checking" ? "Looking for the latest complete monthly observations."
                      : phase === "downloading" ? `${BROWSER_MODELS[modelId].name} downloads up to ${BROWSER_MODELS[modelId].downloadMB} MB. Your browser can save it for future visits.`
                      : "Your device is calculating monthly estimates and uncertainty ranges."
                    : outlookError ||
                      "Monthly estimates will appear when benchmark data is available."}
                </p>
                {phase === "downloading" && progressPercent !== undefined && (
                  <div className="model-progress" role="progressbar" aria-label="Prediction model download" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${progressPercent}%` }} /><small>{progressPercent}%</small>
                  </div>
                )}
                {!outlookLoading && (
                  <button
                    className="text-button"
                    onClick={retryOutlook}
                  >
                    <Icon name="refresh" size={14} /> Check again
                  </button>
                )}
              </div>
            )}
            <div className="outlook-chart-footer">
              <span>Europe Brent spot benchmark · USD / barrel</span>
              <span>
                {outlook
                  ? `Observed through ${fullMonth(outlook.lastObservation)}`
                  : "Complete monthly observations from EIA"}
              </span>
            </div>
          </div>
          {outlook && (outlook.freshness === "stale" || outlookError) && (
            <p className="inline-message" role="status">
              {outlook.freshness === "stale"
                ? `EIA could not be refreshed. Data was last checked ${dateTime(outlook.checkedAt)}.`
                : `Showing the previous prediction from ${dateTime(outlook.generatedAt)}.`}{" "}
              <button onClick={retryOutlook}>
                Retry update
              </button>
            </p>
          )}
          {outlook && (
            <p className="history-note">
              Predictions use published monthly averages. New EIA releases and revisions trigger a new calculation;
              unchanged data reuses your saved result.
            </p>
          )}
          <div className="model-choice">
            <p>Choose a prediction model <span>Your browser can save the model for future visits.</span></p>
            <div role="group" aria-label="Prediction model" className="model-options">
              {(Object.keys(BROWSER_MODELS) as (keyof typeof BROWSER_MODELS)[]).map((id) => (
                <button key={id} onClick={() => chooseModel(id)} aria-pressed={modelId === id}>
                  {id === "chronos-bolt-small" ? "Standard" : "Lightweight"}
                  <span>{BROWSER_MODELS[id].downloadMB} MB</span>
                </button>
              ))}
            </div>
          </div>
          <div className="outlook-explainer">
            <span className="info-dot">i</span>
            <p>
              {horizon > 36
                ? "After month 36: low, base and high scenarios assume 2% annual USD inflation and −2%, 0%, +2% real price growth. These are assumptions, not probability bounds. Prices are nominal USD/barrel. "
                : ""}
              Projections follow the Brent benchmark, not the Hyperliquid
              contract.{" "}
              {annual
                ? "The first three annual ranges average monthly interval endpoints; they are not calibrated annual intervals."
                : "Shading shows the model’s 10th–90th percentile range. Actual coverage on Brent has not yet been established."}
            </p>
          </div>
          {outlook && visible.length > 0 && <>
          <div className="calendar-heading flex items-center justify-between gap-3">
            <h3>{annual ? "Year by year" : "Month by month"}</h3>
            <span className="muted">
              {annual ? `${horizon / 12} years` : `${horizon} months`} ahead
            </span>
          </div>
          <div
            className="calendar-grid"
            aria-label={`${annual ? "Annual" : "Monthly"} projection calendar`}
          >
            {years.map((year) => (
              <div className="calendar-year" key={year}>
                <div className="year-label">
                  {year}
                  <span />
                </div>
                <div className="month-grid">
                  {calendarMonths
                    .filter((m) => m.startsWith(year))
                    .map((month) => {
                      const point = forecastByMonth.get(month);
                      return (
                        <button
                          key={month}
                          className={`month-cell ${selectedMonth === month ? "selected" : ""} ${!point ? "awaiting" : ""}`}
                          onClick={() => openMonth(month)}
                          aria-label={`${fullMonth(month)}: ${point ? `${money(point.estimate)}, range ${money(point.lower)} to ${money(point.upper)}` : "estimate unavailable"}`}
                          aria-haspopup="dialog"
                        >
                          <div className="month-cell-top">
                            <span>
                              {annual
                                ? `${fullMonth(month)} – ${fullMonth(months[months.indexOf(month) + 11])}`
                                : monthName(month)}
                            </span>
                            <span className="month-open">
                              <Icon name="plus" size={14} />
                            </span>
                          </div>
                          <strong>{money(point?.estimate)}</strong>
                          {point?.scenario && (
                            <span className="scenario-label">
                              Base scenario
                            </span>
                          )}
                          <span className="month-range">
                            {point
                              ? `${money(point.lower)} – ${money(point.upper)}`
                              : "Awaiting benchmark data"}
                          </span>
                          {point && (
                            <span className="month-mini-range">
                              <i style={{ left: `${Math.max(0, Math.min(100, (point.estimate - point.lower) / (point.upper - point.lower || 1) * 100))}%` }} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          {calendarLimit < allCalendarMonths.length && (
            <div className="calendar-pagination">
              <span>Showing {calendarMonths.length} of {allCalendarMonths.length} {annual ? "years" : "months"}</span>
              <button className="text-button" onClick={() => setCalendarLimit((n) => n + (annual ? 10 : 12))}>
                Show next {Math.min(annual ? 10 : 12, allCalendarMonths.length - calendarLimit)} {annual ? "years" : "months"}
                <Icon name="plus" size={14} />
              </button>
            </div>
          )}
          <div className="calendar-footnote">
            <span>
              <span className="tiny-blue-dot" />
              {annual
                ? "Annual averages over consecutive 12-month periods"
                : "Monthly averages, not end-of-month targets"}
            </span>
            <span>
              {outlook
                ? `Checked ${dateTime(outlook.checkedAt)}`
                : "Checked when you open this page"}
            </span>
          </div>
          </>}
        </section>
        <section
          className="method-section"
          id="methodology"
          aria-labelledby="method-title"
        >
          <div className="method-intro">
            <div>
              <h2 id="method-title">A forecast, with context.</h2>
              <p>Grounded in history. Open about uncertainty.</p>
            </div>
            <button
              className="method-toggle"
              aria-expanded={methodOpen}
              aria-controls="method-body"
              onClick={toggleMethod}
            >
              {methodOpen ? "Hide methodology" : "How it works"}
              <span
                style={{ transform: methodOpen ? "rotate(45deg)" : undefined }}
              >
                <Icon name="plus" />
              </span>
            </button>
          </div>
          {methodOpen && <ForecastMethodology outlook={outlook} />}
        </section>
        <div className="sources-row">
          <span>Data, with a source.</span>
          <div>
            <a
              href="https://hyperliquid.gitbook.io/hyperliquid-docs"
              target="_blank"
              rel="noreferrer"
            >
              Hyperliquid ↗
            </a>
            <a
              href="https://www.eia.gov/opendata/"
              target="_blank"
              rel="noreferrer"
            >
              U.S. Energy Information Administration ↗
            </a>
          </div>
        </div>
        <p className="disclaimer">
          For information and research. Projections are uncertain and are not
          investment advice.
        </p>
      </main>
      <footer className="site-footer">
        <a className="footer-brand" href="#">
          brent outlook.
        </a>
        <span>A little clarity in a moving market.</span>
        <a href="#main">
          Back to top <Icon name="down" size={14} />
        </a>
      </footer>
      {selectedMonth && (
        <MonthDetail
          key={selectedMonth}
          month={selectedMonth}
          point={forecastByMonth.get(selectedMonth)}
          outlook={outlook}
          onClose={() => setSelectedMonth(undefined)}
        />
      )}
    </div>
  );
}

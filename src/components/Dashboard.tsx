import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import PriceChart, { type ChartPoint } from "./PriceChart";
import { api, useMarket } from "../hooks/useMarket";
import {
  HORIZONS,
  type Horizon,
  type Outlook,
  type Projection,
} from "../lib/types";
import { upcomingMonths, visibleProjections } from "../lib/data";
gsap.registerPlugin(useGSAP);
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
const horizonLabel = (h: number) =>
  h === 12 ? "1Y" : h === 36 ? "3Y" : `${h}M`;
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
          opacity: 0,
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
        opacity: 0,
        duration: 0.18,
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
        <h2 id="month-title">{fullMonth(month)}</h2>
        <div className="detail-price">{money(point?.estimate)}</div>
        <p className="muted">Estimated monthly average · USD per barrel</p>
        {point ? (
          <>
            <div className="range-track">
              <span />
            </div>
            <div className="range-endpoints">
              <div>
                <span>Lower projection</span>
                <strong>{money(point.lower)}</strong>
              </div>
              <div>
                <span>Upper projection</span>
                <strong>{money(point.upper)}</strong>
              </div>
            </div>
            <p className="detail-note">
              An 80% prediction interval, calibrated against historical forecast
              errors. Actual prices may fall outside this range.
            </p>
            <dl className="detail-meta">
              <div>
                <dt>Model</dt>
                <dd>{outlook?.model.model}</dd>
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
  const [horizon, setHorizon] = useState<Horizon>(12),
    [outlook, setOutlook] = useState<Outlook>();
  const [outlookLoading, setOutlookLoading] = useState(true),
    [outlookError, setOutlookError] = useState("");
  const [outlookRevision, setOutlookRevision] = useState(0),
    [selectedMonth, setSelectedMonth] = useState<string>();
  const [methodOpen, setMethodOpen] = useState(false),
    [now, setNow] = useState<Date>();
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    const load = async () => {
      setOutlookLoading(true);
      try {
        const data = await api<Outlook>("/api/outlook", controller.signal);
        if (!stopped) {
          setOutlook(data);
          setOutlookError("");
        }
      } catch (e) {
        if (!stopped)
          setOutlookError(
            e instanceof Error
              ? e.message
              : "The benchmark outlook is temporarily unavailable.",
          );
      } finally {
        if (!stopped) setOutlookLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 86400_000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [outlookRevision]);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from(".site-header", { y: -12, opacity: 0, duration: 0.6 })
            .from(
              ".market-heading",
              { y: 18, opacity: 0, duration: 0.65 },
              "-=.3",
            )
            .from(".price-row", { y: 22, opacity: 0, duration: 0.75 }, "-=.45")
            .from(".market-bottom", { opacity: 0, duration: 0.5 }, "-=.3");
        },
        root,
      );
      return () => mm.revert();
    },
    { scope: root },
  );
  const { contextSafe } = useGSAP({ scope: root });
  const chooseHorizon = contextSafe((value: Horizon) => {
    setHorizon(value);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      gsap.fromTo(
        ".calendar-grid",
        { opacity: 0.4, y: 7 },
        { opacity: 1, y: 0, duration: 0.3, overwrite: "auto" },
      );
  });
  const openMonth = useCallback((month: string) => setSelectedMonth(month), []);
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
  const visible = useMemo(
    () =>
      outlook && now
        ? visibleProjections(outlook.projections, horizon, now)
        : [],
    [outlook, horizon, now],
  );
  const forecastByMonth = new Map(visible.map((p) => [p.month, p]));
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  const livePoints: ChartPoint[] =
    history?.candles.map((c) => ({ time: c.time, value: c.close })) || [];
  const outlookPoints = useMemo<ChartPoint[]>(
    () =>
      !outlook
        ? []
        : [
            ...outlook.observations
              .slice(-12)
              .map((r) => ({
                time: Date.parse(`${r.month}-01T00:00:00Z`),
                value: r.value,
                month: r.month,
              })),
            ...outlook.projections
              .filter(
                (p) =>
                  visible.some((v) => v.month === p.month) ||
                  (now && p.month <= now.toISOString().slice(0, 7)),
              )
              .map((p) => ({
                time: Date.parse(`${p.month}-01T00:00:00Z`),
                value: p.estimate,
                lower: p.lower,
                upper: p.upper,
                forecast: true,
                month: p.month,
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
                <span className="blue-line" /> Brent benchmark outlook
              </div>
              <h2 id="outlook-title">The months ahead.</h2>
              <p className="section-description">
                A longer perspective. One month at a time.
              </p>
            </div>
            <div
              className="segmented horizon-control"
              role="group"
              aria-label="Projection horizon"
            >
              {HORIZONS.map((v) => (
                <button
                  key={v}
                  aria-pressed={horizon === v}
                  onClick={() => chooseHorizon(v)}
                  aria-label={`${v} month projection`}
                >
                  {horizonLabel(v)}
                </button>
              ))}
            </div>
          </div>
          <div className="outlook-chart-wrap" aria-busy={outlookLoading}>
            <div className="outlook-chart-header">
              <span>
                {horizon === 36
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
                <span>
                  <i className="legend-range" />
                  80% range
                </span>
              </div>
            </div>
            <PriceChart
              points={outlookPoints}
              label="Monthly Brent benchmark history and price projections with an 80 percent prediction interval"
              animationKey={`outlook-${horizon}`}
              selectedMonth={selectedMonth}
              onSelectMonth={openMonth}
              monthly
            />
            {!outlook && (
              <div className="chart-empty outlook-empty">
                <span className="outlook-empty-icon">
                  <Icon name="calendar" size={25} />
                </span>
                <h3>
                  {outlookLoading
                    ? "Building the longer view…"
                    : "The outlook is not available yet."}
                </h3>
                <p>
                  {outlookLoading
                    ? "Loading benchmark history and model results."
                    : outlookError ||
                      "Monthly estimates will appear when benchmark data is available."}
                </p>
                {!outlookLoading && (
                  <button
                    className="text-button"
                    onClick={() => setOutlookRevision((v) => v + 1)}
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
                  : "Estimates are never simulated"}
              </span>
            </div>
          </div>
          {outlook && (outlook.freshness === "stale" || outlookError) && (
            <p className="inline-message" role="status">
              Showing the last valid outlook from{" "}
              {dateTime(outlook.generatedAt)}.{" "}
              <button onClick={() => setOutlookRevision((v) => v + 1)}>
                Retry update
              </button>
            </p>
          )}
          <div className="outlook-explainer">
            <span className="info-dot">i</span>
            <p>
              Projections follow the Brent benchmark, not the Hyperliquid
              contract. The shaded range reflects uncertainty, which grows over
              longer horizons.
            </p>
          </div>
          <div className="calendar-heading flex items-center justify-between gap-3">
            <h3>Month by month</h3>
            <span className="muted">{horizon} months ahead</span>
          </div>
          <div
            className="calendar-grid"
            aria-label="Monthly projection calendar"
          >
            {years.map((year) => (
              <div className="calendar-year" key={year}>
                <div className="year-label">
                  {year}
                  <span />
                </div>
                <div className="month-grid">
                  {months
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
                            <span>{monthName(month)}</span>
                            <span className="month-open">
                              <Icon name="plus" size={14} />
                            </span>
                          </div>
                          <strong>{money(point?.estimate)}</strong>
                          <span className="month-range">
                            {point
                              ? `${money(point.lower)} – ${money(point.upper)}`
                              : "Awaiting benchmark data"}
                          </span>
                          {point && (
                            <span className="month-mini-range">
                              <i />
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          <div className="calendar-footnote">
            <span>
              <span className="tiny-blue-dot" />
              Monthly averages, not end-of-month targets
            </span>
            <span>
              {outlook
                ? `Checked ${dateTime(outlook.checkedAt)}`
                : "Checked daily for new benchmark data"}
            </span>
          </div>
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
              onClick={() => setMethodOpen((v) => !v)}
            >
              {methodOpen ? "Hide methodology" : "How it works"}
              <span
                style={{ transform: methodOpen ? "rotate(45deg)" : undefined }}
              >
                <Icon name="plus" />
              </span>
            </button>
          </div>
          {methodOpen && (
            <div className="method-body" id="method-body">
              <div className="method-columns">
                <div>
                  <span className="method-step">01</span>
                  <h3>Start with history</h3>
                  <p>
                    Complete monthly Europe Brent spot observations from EIA.
                    Live perpetual prices are provided separately by
                    Hyperliquid.
                  </p>
                </div>
                <div>
                  <span className="method-step">02</span>
                  <h3>Test the model</h3>
                  <p>
                    A damped trend model competes against the last observed
                    price. Rolling-origin tests use at least 120 months of
                    history and never train on future observations.
                  </p>
                </div>
                <div>
                  <span className="method-step">03</span>
                  <h3>Show the uncertainty</h3>
                  <p>
                    Historical forecast errors calibrate an 80% prediction
                    interval. Longer horizons are projections, not guarantees.
                  </p>
                </div>
              </div>
              {outlook ? (
                <>
                  <div className="model-summary">
                    <span>
                      Selected model<strong>{outlook.model.model}</strong>
                    </span>
                    <span>
                      Last calculated
                      <strong>{dateTime(outlook.generatedAt)}</strong>
                    </span>
                  </div>
                  <div className="metrics-scroll">
                    <table>
                      <caption>Out-of-sample model performance</caption>
                      <thead>
                        <tr>
                          <th>Horizon</th>
                          <th>Model MAE</th>
                          <th>Baseline MAE</th>
                          <th>Range coverage</th>
                          <th>Tests / coverage tests</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outlook.model.metrics.map((m) => (
                          <tr key={m.horizon}>
                            <th>{horizonLabel(m.horizon)}</th>
                            <td>{money(m.mae)}</td>
                            <td>{money(m.baselineMae)}</td>
                            <td>
                              {m.coverage === null
                                ? "Not enough tests"
                                : `${(m.coverage * 100).toFixed(1)}%`}
                            </td>
                            <td>
                              {m.samples} / {m.coverageSamples}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="method-small">
                    MAE is the average absolute forecast error in USD/barrel;
                    lower is better. Coverage uses only errors whose outcomes
                    were known at each test date. Selection uses the same
                    backtest, so these are diagnostic results, not an
                    independent final holdout.
                  </p>
                  <p className="method-small">
                    Engine {outlook.model.version} · Rust / WebAssembly ·{" "}
                    {outlook.performance.computationMs.toFixed(1)}ms computation
                    · {outlook.performance.initializationMs.toFixed(1)}ms
                    initialization
                  </p>
                </>
              ) : (
                <p className="evaluation-empty">
                  Model performance and interval coverage will appear with the
                  first valid benchmark outlook.
                </p>
              )}
              <p className="method-small">
                Backtests use the currently available historical dataset, which
                may include revisions. They do not recreate the exact releases
                available at each past date. Price-only models do not directly
                account for geopolitical shocks, supply decisions, or structural
                market changes.
              </p>
            </div>
          )}
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

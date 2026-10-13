"""Feature pipeline and the per-agency late-pickup model.

Locally this stands in for the Databricks feature pipeline and model training job:
  history rows (an_run_history) -> features -> L2-regularised binomial logistic regression
  (Newton / IRLS in NumPy) -> versioned model in an_models.

Target: share of completed pickups that were late, per run. The model is small,
interpretable and trains in well under a second, which makes the what-if levers honest:
every recommended lever is a change to real feature values, scored by the trained model.
"""
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import new_id, now
from app.models import OpsRunHistory, PerformanceModel

CATEGORICAL = ["route_name", "hour_band", "weather", "dow_name", "vehicle_type", "tenure_band"]
NUMERIC = ["load_factor", "recovery_min", "avg_dwell_min", "no_shows", "wheelchair_boardings", "pm_overdue", "road_call"]
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
FEATURE_LABELS = {
    "load_factor": "Crowding (load factor)", "recovery_min": "Recovery time in schedule", "avg_dwell_min": "Dwell time per stop",
    "no_shows": "No-shows per run", "wheelchair_boardings": "Wheelchair boardings", "pm_overdue": "Vehicle overdue for maintenance",
    "road_call": "Breakdown during run", "route_name": "Route", "hour_band": "Time of day", "weather": "Weather",
    "dow_name": "Day of week", "vehicle_type": "Vehicle type", "tenure_band": "Operator experience",
}
HOLDOUT_DAYS = 14
L2 = 1.0


def tenure_band(years: float) -> str:
    return "under 1 year" if years < 1 else "1-3 years" if years < 3 else "3+ years"


def to_record(r: OpsRunHistory) -> dict[str, Any]:
    return {
        "id": r.id, "service_date": r.service_date, "dow_name": DOW[r.dow], "route_name": r.route_name, "block": r.block,
        "hour_band": r.hour_band, "depot": r.depot, "vehicle_label": r.vehicle_label, "vehicle_type": r.vehicle_type,
        "driver_id": r.driver_id, "driver_name": r.driver_name, "tenure_years": r.driver_tenure_years, "tenure_band": tenure_band(r.driver_tenure_years),
        "weather": r.weather, "scheduled_trips": r.scheduled_trips, "completed_trips": r.completed_trips, "no_shows": r.no_shows,
        "late_cancels": r.late_cancels, "wheelchair_boardings": r.wheelchair_boardings, "load_factor": r.load_factor,
        "recovery_min": r.recovery_min, "avg_dwell_min": r.avg_dwell_min, "pm_overdue": float(r.pm_overdue), "road_call": float(r.road_call),
        "on_time_pickups": r.on_time_pickups, "late_pickups": r.late_pickups, "avg_late_min": r.avg_late_min,
    }


async def load_history(s: AsyncSession, tenant_id: str, since: Optional[date] = None) -> list[dict[str, Any]]:
    q = select(OpsRunHistory).where(OpsRunHistory.tenant_id == tenant_id)
    if since:
        q = q.where(OpsRunHistory.service_date >= since)
    return [to_record(r) for r in (await s.execute(q.order_by(OpsRunHistory.service_date))).scalars()]


class Encoder:
    """One-hot for categoricals, z-score for numerics. Unknown levels map to all zeros."""

    def __init__(self, levels: dict[str, list[str]], means: dict[str, float], stds: dict[str, float]):
        self.levels, self.means, self.stds = levels, means, stds
        self.names = ["intercept"] + [f"{c}={v}" for c in CATEGORICAL for v in levels[c]] + NUMERIC

    @classmethod
    def fit(cls, rows: list[dict]) -> "Encoder":
        levels = {c: sorted({str(r[c]) for r in rows}) for c in CATEGORICAL}
        means = {n: float(np.mean([r[n] for r in rows])) for n in NUMERIC}
        stds = {n: float(np.std([r[n] for r in rows]) or 1.0) for n in NUMERIC}
        return cls(levels, means, stds)

    def transform(self, rows: list[dict]) -> np.ndarray:
        idx = {name: i for i, name in enumerate(self.names)}
        X = np.zeros((len(rows), len(self.names)))
        X[:, 0] = 1.0
        for i, r in enumerate(rows):
            for c in CATEGORICAL:
                j = idx.get(f"{c}={r[c]}")
                if j is not None:
                    X[i, j] = 1.0
            for n in NUMERIC:
                X[i, idx[n]] = (r[n] - self.means[n]) / self.stds[n]
        return X

    def to_dict(self) -> dict:
        return {"levels": self.levels, "means": self.means, "stds": self.stds}


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


def fit_logit(X: np.ndarray, late: np.ndarray, n: np.ndarray, l2: float = L2, iters: int = 30) -> np.ndarray:
    p = X.shape[1]
    rate = max(1e-4, min(1 - 1e-4, late.sum() / n.sum()))
    beta = np.zeros(p)
    beta[0] = np.log(rate / (1 - rate))
    reg = np.full(p, l2)
    reg[0] = 0.0
    for _ in range(iters):
        # numpy 2.x on macOS (Accelerate BLAS) raises spurious floating-point warnings inside matmul even when every
        # input and output is finite, so silence them here and check the results explicitly instead.
        with np.errstate(over="ignore", divide="ignore", invalid="ignore"):
            mu = _sigmoid(X @ beta)
            grad = X.T @ (late - n * mu) - reg * beta
            W = n * mu * (1 - mu)
            H = (X * W[:, None]).T @ X + np.diag(reg) + 1e-9 * np.eye(p)
        if not (np.isfinite(grad).all() and np.isfinite(H).all()):
            raise ValueError("Model training diverged (non-finite gradient); check the feature table for bad values.")
        step = np.linalg.solve(H, grad)
        beta += step
        if np.max(np.abs(step)) < 1e-7:
            break
    return beta


class LateModel:
    def __init__(self, encoder: Encoder, beta: np.ndarray):
        self.encoder, self.beta = encoder, beta

    def late_prob(self, rows: list[dict]) -> np.ndarray:
        with np.errstate(over="ignore", divide="ignore", invalid="ignore"):  # see fit_logit
            z = self.encoder.transform(rows) @ self.beta
        if not np.isfinite(z).all():
            raise ValueError("Model produced non-finite scores; retrain the model.")
        return _sigmoid(z)

    def predicted_otp(self, rows: list[dict]) -> float:
        n = np.array([r["completed_trips"] for r in rows], dtype=float)
        if n.sum() == 0:
            return 0.0
        return float(100 * (n * (1 - self.late_prob(rows))).sum() / n.sum())

    @classmethod
    def from_params(cls, params: dict) -> "LateModel":
        e = params["encoder"]
        return cls(Encoder(e["levels"], e["means"], e["stds"]), np.array(params["beta"]))

    def params(self) -> dict:
        return {"encoder": self.encoder.to_dict(), "beta": self.beta.tolist(), "names": self.encoder.names}

    def importance(self) -> list[dict]:
        """Group effect size: spread of level coefficients for categories, |coef| per 1 std for numerics."""
        b = dict(zip(self.encoder.names, self.beta))
        out = []
        for c in CATEGORICAL:
            vals = {v: b[f"{c}={v}"] for v in self.encoder.levels[c]}
            if not vals:
                continue
            worst = max(vals, key=vals.get)
            best = min(vals, key=vals.get)
            out.append({"feature": c, "label": FEATURE_LABELS[c], "kind": "category", "strength": round(float(vals[worst] - vals[best]), 3),
                        "worst": worst, "best": best, "odds_ratio_worst_vs_best": round(float(np.exp(vals[worst] - vals[best])), 2)})
        for nme in NUMERIC:
            coef = b[nme]
            per_unit = coef / self.encoder.stds[nme]
            out.append({"feature": nme, "label": FEATURE_LABELS[nme], "kind": "numeric", "strength": round(abs(float(coef)), 3),
                        "direction": "more lateness" if coef > 0 else "less lateness",
                        "odds_ratio_per_unit": round(float(np.exp(per_unit)), 3)})
        return sorted(out, key=lambda x: -x["strength"])


def _arrays(rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    return (np.array([r["late_pickups"] for r in rows], dtype=float), np.array([r["completed_trips"] for r in rows], dtype=float))


def _log_loss(late: np.ndarray, n: np.ndarray, p: np.ndarray) -> float:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-(late * np.log(p) + (n - late) * np.log(1 - p)).sum() / n.sum())


def train_on(rows: list[dict]) -> tuple[LateModel, dict]:
    rows = [r for r in rows if r["completed_trips"] > 0]
    if len(rows) < 200:
        raise ValueError("Not enough history to train (need at least 200 runs).")
    last = max(r["service_date"] for r in rows)
    cut = last - timedelta(days=HOLDOUT_DAYS)
    train, test = [r for r in rows if r["service_date"] <= cut], [r for r in rows if r["service_date"] > cut]
    enc = Encoder.fit(train)
    late_tr, n_tr = _arrays(train)
    beta = fit_logit(enc.transform(train), late_tr, n_tr)
    m = LateModel(enc, beta)
    late_te, n_te = _arrays(test)
    p_te = m.late_prob(test)
    const = late_tr.sum() / n_tr.sum()
    actual_otp = 100 * (1 - late_te.sum() / n_te.sum())
    pred_otp = 100 * (n_te * (1 - p_te)).sum() / n_te.sum()
    row_mae = float(np.mean(np.abs(late_te / n_te - p_te)) * 100)
    ll, ll_const = _log_loss(late_te, n_te, p_te), _log_loss(late_te, n_te, np.full_like(p_te, const))
    # Daily OTP tracking on holdout: how well the model follows day-to-day swings
    days = sorted({r["service_date"] for r in test})
    daily = []
    for d in days:
        idx = [i for i, r in enumerate(test) if r["service_date"] == d]
        daily.append((100 * (1 - late_te[idx].sum() / n_te[idx].sum()), 100 * (n_te[idx] * (1 - p_te[idx])).sum() / n_te[idx].sum()))
    daily_mae = float(np.mean([abs(a - b) for a, b in daily])) if daily else None
    corr = float(np.corrcoef([a for a, _ in daily], [b for _, b in daily])[0, 1]) if len(daily) > 2 else None
    metrics = {
        "train_rows": len(train), "holdout_rows": len(test), "holdout_days": HOLDOUT_DAYS,
        "holdout_otp_actual": round(float(actual_otp), 2), "holdout_otp_predicted": round(float(pred_otp), 2),
        "holdout_daily_otp_mae_pp": round(daily_mae, 2) if daily_mae is not None else None,
        "holdout_daily_otp_correlation": round(corr, 3) if corr is not None else None,
        "holdout_run_late_rate_mae_pp": round(row_mae, 2),
        "log_loss": round(ll, 4), "log_loss_constant": round(ll_const, 4),
        "log_loss_improvement_pct": round(100 * (ll_const - ll) / ll_const, 1),
    }
    # Production model: refit on all rows
    enc_all = Encoder.fit(rows)
    late_all, n_all = _arrays(rows)
    final = LateModel(enc_all, fit_logit(enc_all.transform(rows), late_all, n_all))
    return final, metrics


async def train(s: AsyncSession, tenant_id: str, user_name: str = "system") -> PerformanceModel:
    rows = await load_history(s, tenant_id)
    model, metrics = train_on(rows)
    prev = (await s.execute(select(PerformanceModel.version).where(PerformanceModel.tenant_id == tenant_id)
                            .order_by(PerformanceModel.version.desc()).limit(1))).scalar_one_or_none()
    await s.execute(update(PerformanceModel).where(PerformanceModel.tenant_id == tenant_id).values(active=False))
    params = model.params()
    params["importance"] = model.importance()
    pm = PerformanceModel(id=new_id("mdl"), tenant_id=tenant_id, version=(prev or 0) + 1, trained_at=now(), trained_by=user_name,
                          rows=len(rows), date_from=min(r["service_date"] for r in rows), date_to=max(r["service_date"] for r in rows),
                          metrics=metrics, params=params, active=True,
                          notes="Binomial logistic regression (L2) on run-level history; holdout = last 14 days.")
    s.add(pm)
    await s.flush()
    _CACHE.pop(tenant_id, None)
    return pm


async def active_model(s: AsyncSession, tenant_id: str) -> Optional[PerformanceModel]:
    return (await s.execute(select(PerformanceModel).where(PerformanceModel.tenant_id == tenant_id, PerformanceModel.active.is_(True))
                            .order_by(PerformanceModel.version.desc()).limit(1))).scalar_one_or_none()


_CACHE: dict[str, tuple[str, LateModel]] = {}


def model_from_row(pm: PerformanceModel) -> LateModel:
    hit = _CACHE.get(pm.tenant_id)
    if hit and hit[0] == pm.id:
        return hit[1]
    m = LateModel.from_params(pm.params)
    _CACHE[pm.tenant_id] = (pm.id, m)
    return m


def model_card(pm: PerformanceModel) -> dict:
    return {"id": pm.id, "version": pm.version, "kind": pm.kind, "trained_at": pm.trained_at, "trained_by": pm.trained_by, "rows": pm.rows,
            "date_from": pm.date_from, "date_to": pm.date_to, "metrics": pm.metrics, "notes": pm.notes,
            "importance": pm.params.get("importance", [])[:8], "features": len(pm.params.get("names", []))}

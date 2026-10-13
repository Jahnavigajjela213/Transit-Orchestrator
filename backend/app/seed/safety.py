"""Synthetic Vestige data: a compliance record for every driver, a safety id for every vehicle.

Idempotent, so it also back-fills databases created before the safety product existed.
A few spare drivers are deliberately out of compliance so the orchestrator has something to avoid.
"""
import random
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import new_id, now
from app.models import CanonicalEntity, Crosswalk, Employee, Run, SafetyDriver, Tenant


async def ensure_safety_seed(s: AsyncSession) -> dict:
    created = {"drivers": 0, "vehicles": 0}
    today = now().date()
    for tenant in (await s.execute(select(Tenant).order_by(Tenant.id))).scalars().all():
        tid = tenant.id
        have = set((await s.execute(select(Crosswalk.canonical_id).where(Crosswalk.tenant_id == tid, Crosswalk.system == "safety"))).scalars())
        rng = random.Random(f"safety:{tid}")
        rostered = set((await s.execute(select(Run.driver_code).where(Run.tenant_id == tid))).scalars())

        vehicles = (await s.execute(select(CanonicalEntity).where(CanonicalEntity.tenant_id == tid, CanonicalEntity.entity_type == "vehicle")
                                    .order_by(CanonicalEntity.id))).scalars().all()
        for v in vehicles:
            if v.id in have:
                continue
            s.add(Crosswalk(id=new_id("xw"), tenant_id=tid, entity_type="vehicle", canonical_id=v.id, system="safety", external_id=f"VS-V{v.label.split('-')[-1]}{tenant.code[0]}"))
            created["vehicles"] += 1

        rows = (await s.execute(select(Crosswalk.canonical_id, Crosswalk.external_id).where(
            Crosswalk.tenant_id == tid, Crosswalk.system == "workforce", Crosswalk.entity_type == "driver").order_by(Crosswalk.canonical_id))).all()
        trip_codes = dict((await s.execute(select(Crosswalk.canonical_id, Crosswalk.external_id).where(
            Crosswalk.tenant_id == tid, Crosswalk.system == "trip_mgmt", Crosswalk.entity_type == "driver"))).all())
        spare_cids = [cid for cid, _ in rows if trip_codes.get(cid) not in rostered]
        lapses = {}
        if len(spare_cids) >= 8:
            picks = rng.sample(spare_cids, 4)
            lapses = {picks[0]: "medical_card", picks[1]: "suspended", picks[2]: "training", picks[3]: "training"}
        elif len(spare_cids) >= 4:
            picks = rng.sample(spare_cids, 2)
            lapses = {picks[0]: "medical_card", picks[1]: "training"}
        for n, (cid, emp_no) in enumerate(rows, start=1):
            if cid in have:
                continue
            emp = await s.get(Employee, emp_no)
            sid = f"VS-D{2000 + n}{tenant.code[0]}"
            issue = lapses.get(cid)
            d = SafetyDriver(
                safety_id=sid, tenant_id=tid, name=emp.full_name if emp else cid,
                medical_card_expires=today + timedelta(days=rng.randint(30, 700)),
                drug_test_due=today + timedelta(days=rng.randint(5, 120)),
                securement_training_due=today + timedelta(days=rng.randint(10, 300)),
                status="compliant", preventable_incidents_12m=rng.choices([0, 0, 0, 1, 2], k=1)[0],
            )
            if issue == "medical_card":
                d.medical_card_expires = today - timedelta(days=rng.randint(1, 20))
            elif issue == "suspended":
                d.status, d.notes, d.preventable_incidents_12m = "suspended", "pending review of a preventable incident", 2
            elif issue == "training":
                d.securement_training_due = today - timedelta(days=rng.randint(1, 30))
            s.add(d)
            s.add(Crosswalk(id=new_id("xw"), tenant_id=tid, entity_type="driver", canonical_id=cid, system="safety", external_id=sid))
            created["drivers"] += 1
    await s.flush()
    return created

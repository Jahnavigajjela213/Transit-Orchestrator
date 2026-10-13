"""Synthetic data for two transit agencies. Deterministic for a given seed.

Everything is generated relative to today, so the demo always has runs
yesterday, today and the next two days. Replace by connecting real product APIs.
"""
import random
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import new_id, now
from app.core.security import hash_password
from app.models import (
    Asset, AvailabilityBlock, CanonicalEntity, Crosswalk, Employee, FaultCode, FleetVehicle, Rider, Run, ShopCapacity,
    TelemetryDevice, TelemetryReading, Tenant, Trip, TripDriver, User, WorkOrder,
)
from app.policy.defaults import DEFAULT_RULES
from app.products.catalog import DEPOTS, FAULT_CODES, VEHICLE_TYPES

DEMO_PASSWORD = "demo1234"

FIRST = ["Dana", "Luis", "Mei", "Andre", "Priya", "Tom", "Grace", "Omar", "Sofia", "Kenji", "Aisha", "Ben", "Carmen", "Dev", "Elena",
         "Frank", "Hana", "Ivan", "Jada", "Kofi", "Lena", "Marco", "Nina", "Oscar", "Paula", "Quinn", "Rosa", "Sam", "Tara", "Uma",
         "Victor", "Wen", "Xavier", "Yara", "Zane", "Alma", "Bilal", "Chloe", "Diego", "Esme", "Femi", "Gus", "Hiro", "Iris", "Jon"]
LAST = ["Alvarez", "Chen", "Okafor", "Patel", "Nguyen", "Brooks", "Kim", "Haddad", "Russo", "Tanaka", "Ward", "Silva", "Morales",
        "Iyer", "Novak", "Fischer", "Yamada", "Petrov", "Coleman", "Mensah", "Larsen", "Bianchi", "Ortiz", "Zhang", "Hughes", "Ramos"]
STREETS = ["Oak", "Mission", "Harbor", "Elm", "Valley", "Main", "Lakeview", "Cedar", "Sunset", "Market", "Pine", "Union", "Bayshore",
           "Grant", "Lincoln", "Riverside", "Fremont", "Alameda"]
PLACES = ["Medical Center", "Senior Center", "City Hall", "Transit Center", "Community College", "Library", "Dialysis Clinic",
          "Shopping Plaza", "VA Clinic", "Rec Center", "Farmers Market", "Courthouse"]
MAKES = {"40ft Bus": ("Gillig", "Low Floor 40"), "35ft Bus": ("New Flyer", "Xcelsior 35"),
         "Cutaway": ("Ford", "E-450 ElDorado"), "Paratransit Van": ("Ford", "Transit Braun")}

TENANTS = [
    {"id": "ten_mvt", "code": "MVT", "name": "Metro Valley Transit", "prefix": "V", "start": 101,
     "fleet": [("40ft Bus", 12), ("35ft Bus", 6), ("Cutaway", 4), ("Paratransit Van", 4)], "spares_per_type": 1, "extra_drivers": 6,
     "routes": ["Route 12 Downtown", "Route 22 Eastgate", "Route 7 Harbor", "Route 31 College", "Route 4 Airport", "Route 18 Valley",
                "Route 9 Medical Ctr", "Route 40 Express", "Route 15 Riverside", "Route 2 Crosstown", "Flex Zone North", "Flex Zone South"],
     "riders": 220, "persona": "mvt-orchestrator-agent"},
    {"id": "ten_lsp", "code": "LSP", "name": "Lakeshore Paratransit", "prefix": "P", "start": 201,
     "fleet": [("35ft Bus", 2), ("Cutaway", 5), ("Paratransit Van", 13)], "spares_per_type": 1, "extra_drivers": 5,
     "routes": ["ADA Zone A", "ADA Zone B", "ADA Zone C", "Dialysis Shuttle", "Senior Loop", "Lakeshore Connector", "Medical Express"],
     "riders": 130, "persona": "lsp-orchestrator-agent"},
]


def _name(rng: random.Random, used: set) -> str:
    while True:
        n = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        if n not in used:
            used.add(n)
            return n


def _xw(tenant_id: str, etype: str, cid: str, system: str, ext: str) -> Crosswalk:
    return Crosswalk(id=new_id("xw"), tenant_id=tenant_id, entity_type=etype, canonical_id=cid, system=system, external_id=ext)


async def is_seeded(s: AsyncSession) -> bool:
    return (await s.execute(select(func.count()).select_from(Tenant))).scalar_one() > 0


async def seed(s: AsyncSession, random_seed: int = 42) -> dict:
    rng = random.Random(random_seed)
    today = now().date()
    days = [today + timedelta(days=d) for d in (-1, 0, 1, 2)]
    t_now = now()
    stats: dict = {}

    for code, desc, system, sev, hours, access in FAULT_CODES:
        s.add(FaultCode(code=code, description=desc, system=system, severity=sev, est_repair_hours=hours, affects_accessibility=access))
    s.add(FaultCode(code="PM-DUE", description="Preventive maintenance overdue", system="Maintenance", severity="medium", est_repair_hours=4))
    await s.flush()

    for t in TENANTS:
        tid = t["id"]
        used_names: set = set()
        s.add(Tenant(id=tid, code=t["code"], name=t["name"], agent_persona=t["persona"]))
        await s.flush()
        from app.models import Policy
        s.add(Policy(id=new_id("pol"), tenant_id=tid, workflow_type="vehicle_health", version=1,
                     rules=DEFAULT_RULES["vehicle_health"] if tid == "ten_mvt" else {
                         # Lakeshore trusts the agent more for critical faults: opens the work order on its own.
                         **DEFAULT_RULES["vehicle_health"],
                         "steps": {**DEFAULT_RULES["vehicle_health"]["steps"],
                                   "open_work_order": {**DEFAULT_RULES["vehicle_health"]["steps"]["open_work_order"],
                                                       "by_severity": {"low": "informational", "critical": "autonomous"}}},
                     }, updated_by="system"))
        code_l = t["code"].lower()
        for role, title in (("dispatcher", "Dispatcher"), ("shop_manager", "Shop Manager"), ("admin", "Operations Admin"), ("viewer", "Analyst")):
            s.add(User(id=new_id("usr"), tenant_id=tid, email=f"{role.replace('_', '')}@{code_l}.demo", full_name=f"{_name(rng, used_names)}",
                       role=role, password_hash=hash_password(DEMO_PASSWORD)))
        await s.flush()

        # ---- vehicles: canonical + asset mgmt + trip mgmt + telematics
        vehicles = []
        n = t["start"]
        for vtype, count in t["fleet"]:
            cap, wc, _, _ = VEHICLE_TYPES[vtype]
            for i in range(count):
                label = f"{t['prefix']}-{n}"
                cid = f"veh_{code_l}_{n}"
                asset_no = f"FA-{n * 97 + 10000}"
                trip_code = f"TM-{t['prefix']}{n}"
                device = f"TLM-{rng.randrange(0x1000, 0xFFFF):04X}"
                depot = DEPOTS[i % 2]
                s.add(CanonicalEntity(id=cid, tenant_id=tid, entity_type="vehicle", label=label))
                s.add_all([_xw(tid, "vehicle", cid, "asset_mgmt", asset_no), _xw(tid, "vehicle", cid, "trip_mgmt", trip_code),
                           _xw(tid, "vehicle", cid, "telematics", device)])
                odo = rng.randint(40_000, 320_000)
                since_pm = rng.randint(400, 5600)
                make, model = MAKES[vtype]
                s.add(Asset(asset_number=asset_no, tenant_id=tid, unit_label=label, make=make, model=model, year=rng.randint(2014, 2024),
                            vin=f"1F{rng.randrange(10**14, 10**15)}", odometer=odo, last_pm_date=today - timedelta(days=rng.randint(10, 80)),
                            last_pm_odometer=odo - since_pm, pm_interval_miles=6000, status="active", depot=depot))
                s.add(FleetVehicle(vehicle_code=trip_code, tenant_id=tid, label=label, vehicle_type=vtype, capacity=cap,
                                   wheelchair_positions=wc, depot=depot, status="available"))
                s.add(TelemetryDevice(device_id=device, tenant_id=tid))
                s.add(TelemetryReading(id=new_id("tlr"), tenant_id=tid, device_id=device, ts=t_now, engine_temp_c=round(rng.uniform(84, 95), 1),
                                       oil_pressure_kpa=round(rng.uniform(250, 370), 1), battery_v=round(rng.uniform(12.6, 14.1), 2),
                                       speed_kph=0.0, odometer=odo, dtc_codes=[]))
                vehicles.append({"cid": cid, "label": label, "type": vtype, "trip_code": trip_code, "asset": asset_no, "depot": depot, "cap": cap, "wc": wc})
                n += 1

        # spares: last N of each type have no runs; the very last spare is already in the shop
        spares, by_type = [], {}
        for v in vehicles:
            by_type.setdefault(v["type"], []).append(v)
        for vtype, vs in by_type.items():
            spares += vs[-t["spares_per_type"]:]
        in_service = [v for v in vehicles if v not in spares]
        in_shop = spares[-1]

        # ---- PM overdue: two in-service vehicles cross the interval (one medium, one high)
        assets = {v["asset"]: v for v in vehicles}
        await s.flush()
        for v, over in ((in_service[2], 420), (in_service[-3], 1850)):
            a = await s.get(Asset, v["asset"])
            a.last_pm_odometer = a.odometer - 6000 - over
            a.last_pm_date = today - timedelta(days=95)

        # ---- drivers: workforce + trip mgmt + canonical
        drivers = []
        dn = 1

        def make_driver(lic: str, certs: list[str], depot: str):
            nonlocal dn
            cid = f"drv_{code_l}_{dn:03d}"
            emp = f"BC-E{1000 + dn + (0 if tid == 'ten_mvt' else 500)}"
            tcode = f"TM-D{dn:03d}{t['prefix']}"
            name = _name(rng, used_names)
            s.add(CanonicalEntity(id=cid, tenant_id=tid, entity_type="driver", label=name))
            s.add_all([_xw(tid, "driver", cid, "workforce", emp), _xw(tid, "driver", cid, "trip_mgmt", tcode)])
            s.add(Employee(employee_number=emp, tenant_id=tid, full_name=name, license_class=lic, certifications=certs, status="active",
                           home_depot=depot, max_daily_hours=rng.choice([10.0, 10.0, 12.0]), phone=f"(555) {rng.randint(200, 999)}-{rng.randint(1000, 9999)}"))
            s.add(TripDriver(driver_code=tcode, tenant_id=tid, name=name))
            d = {"cid": cid, "tcode": tcode, "lic": lic, "certs": certs, "depot": depot, "name": name}
            drivers.append(d)
            dn += 1
            return d

        slots = {}
        for v in in_service:
            needs_ab = VEHICLE_TYPES[v["type"]][3]
            for block in ("AM", "PM"):
                lic = "B" if VEHICLE_TYPES[v["type"]][2] == "B" else rng.choice(["B", "C", "C"])
                certs = ["wheelchair_securement"] + (["air_brakes"] if needs_ab or (lic == "B" and rng.random() < 0.6) else [])
                slots[(v["cid"], block)] = make_driver(lic, certs, v["depot"])
        for i in range(t["extra_drivers"]):
            lic = rng.choice(["B", "B", "C"])
            certs = [c for c in ("wheelchair_securement", "air_brakes") if rng.random() < (0.85 if c == "wheelchair_securement" else 0.7)]
            if lic == "C" and "air_brakes" in certs:
                certs.remove("air_brakes")
            make_driver(lic, certs, DEPOTS[i % 2])
        # one driver on leave to show the constraint
        await s.flush()
        leave = await s.get(Employee, (await s.execute(select(Crosswalk.external_id).where(
            Crosswalk.canonical_id == drivers[-1]["cid"], Crosswalk.system == "workforce"))).scalar_one())
        leave.status = "leave"

        # ---- riders
        riders = []
        for i in range(t["riders"]):
            rid = f"rdr_{code_l}_{i + 1:04d}"
            name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
            lang = rng.choices(["en", "es", "zh"], weights=[70, 20, 10])[0]
            s.add(Rider(id=rid, tenant_id=tid, name=name, phone=f"(555) {rng.randint(200, 999)}-{rng.randint(1000, 9999)}",
                        email=f"{name.lower().replace(' ', '.')}{i}@example.com", preferred_channel=rng.choices(["sms", "app", "email"], weights=[50, 30, 20])[0],
                        language=lang))
            riders.append(rid)

        # ---- runs + trips for 4 days
        run_count = trip_count = 0
        for day in days:
            for vi, v in enumerate(in_service):
                route = t["routes"][vi % len(t["routes"])]
                for block, (h0, h1) in (("AM", (5, 11)), ("PM", (12, 18))):
                    offset = timedelta(minutes=rng.choice([0, 15, 30, 45]))
                    start = datetime.combine(day, time(h0, 30)) + offset
                    end = datetime.combine(day, time(h1, 30)) + offset
                    status = "completed" if end < t_now else ("in_progress" if start <= t_now else "scheduled")
                    rid = f"RUN-{t['code']}-{day:%m%d}-{v['label'][2:]}-{block}"
                    drv = slots[(v["cid"], block)]
                    s.add(Run(id=rid, tenant_id=tid, service_date=day, route_name=route, block_name=f"{v['label'][2:]}{block}",
                              start_time=start, end_time=end, vehicle_code=v["trip_code"], driver_code=drv["tcode"], status=status))
                    run_count += 1
                    lo, hi = {"40ft Bus": (10, 22), "35ft Bus": (8, 18), "Cutaway": (5, 12), "Paratransit Van": (3, 7)}[v["type"]]
                    count = min(v["cap"], rng.randint(lo, hi))
                    wc_left = v["wc"]
                    span_min = int((end - start).total_seconds() // 60) - 20
                    for k in range(count):
                        pickup = start + timedelta(minutes=10 + int(span_min * k / max(1, count)))
                        needs_wc = wc_left > 0 and rng.random() < (0.25 if v["type"] == "Paratransit Van" else 0.08)
                        if needs_wc:
                            wc_left -= 1
                        trid = f"trp_{code_l}_{day:%m%d}_{v['label'][2:]}{block}_{k:02d}"
                        trip_status = "completed" if pickup < t_now - timedelta(minutes=30) else "booked"
                        s.add(Trip(id=trid, tenant_id=tid, run_id=rid, rider_id=rng.choice(riders), pickup_time=pickup, eta=pickup,
                                   pickup_stop=f"{rng.randint(100, 2999)} {rng.choice(STREETS)} St", dropoff_stop=rng.choice(PLACES),
                                   needs_wheelchair=needs_wc, status=trip_status))
                        s.add(CanonicalEntity(id=trid, tenant_id=tid, entity_type="trip", label=f"{rid} #{k + 1}"))
                        s.add(_xw(tid, "trip", trid, "trip_mgmt", trid))
                        trip_count += 1

        # ---- shop capacity
        for d in range(-1, 15):
            for depot in DEPOTS:
                s.add(ShopCapacity(id=new_id("cap"), tenant_id=tid, depot=depot, day=today + timedelta(days=d),
                                   bays_total=3 if depot == DEPOTS[0] else 2, bays_booked=rng.choice([0, 0, 1])))

        # ---- one vehicle already in the shop (manual work order from yesterday)
        a = await s.get(Asset, in_shop["asset"])
        a.status = "in_shop"
        s.add(WorkOrder(id=f"WO-{today.year}-{tid[-3:].upper()}01", tenant_id=tid, asset_number=in_shop["asset"], status="in_progress",
                        priority="high", fault_code="HVAC-05", title="HVAC compressor replacement", description="Reported by operator; parts on order.",
                        source="manual", shop_depot=in_shop["depot"], shop_start=datetime.combine(today - timedelta(days=1), time(8, 0)),
                        shop_end=datetime.combine(today + timedelta(days=1), time(17, 0)), created_by="Shop", created_at=t_now - timedelta(days=1)))
        s.add(AvailabilityBlock(id=new_id("blk"), tenant_id=tid, vehicle_code=in_shop["trip_code"],
                                start=datetime.combine(today - timedelta(days=1), time(8, 0)), end=datetime.combine(today + timedelta(days=1), time(17, 0)),
                                reason="Shop: HVAC compressor replacement", source_ref=f"manual-{in_shop['label']}"))
        fv = await s.get(FleetVehicle, in_shop["trip_code"])
        fv.status = "out_of_service"

        stats[t["code"]] = {"vehicles": len(vehicles), "drivers": len(drivers), "riders": len(riders), "runs": run_count, "trips": trip_count,
                            "spares": [v["label"] for v in spares if v is not in_shop], "in_shop": in_shop["label"]}
    await s.flush()
    from app.seed.extras import seed_extras

    extra = await seed_extras(s, [t["id"] for t in TENANTS], random_seed)
    for t in TENANTS:
        stats[t["code"]].update(extra[t["id"]])
    return stats

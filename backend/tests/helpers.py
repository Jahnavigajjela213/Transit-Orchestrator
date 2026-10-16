from app.core.event_bus import bus


async def inject(client, headers, vehicle: str, code: str) -> dict:
    r = await client.post("/api/simulator/fault", json={"vehicle_label": vehicle, "fault_code": code}, headers=headers)
    assert r.status_code == 200, r.text
    await bus.drain()
    return r.json()


async def workflow_for(client, headers, vehicle: str, workflow_type: str = "vehicle_health") -> dict:
    # No-show workflows also carry the run's vehicle label, so filter by type.
    r = await client.get("/api/workflows", params={"vehicle": vehicle, "workflow_type": workflow_type}, headers=headers)
    rows = r.json()
    assert rows, f"no workflow for {vehicle}"
    detail = await client.get(f"/api/workflows/{rows[0]['id']}", headers=headers)
    return detail.json()


def pending(wf: dict, kind: str = "approval") -> dict | None:
    return next((a for a in wf["approvals"] if a["status"] == "pending" and a["kind"] == kind), None)


async def decide(client, headers, approval_id: str, action: str = "approve", **body) -> dict:
    r = await client.post(f"/api/approvals/{approval_id}/decision", json={"action": action, **body}, headers=headers)
    assert r.status_code == 200, r.text
    await bus.drain()
    return r.json()


async def approve_until(client, headers, vehicle: str, stop_step: str | None = None) -> dict:
    for _ in range(6):
        wf = await workflow_for(client, headers, vehicle)
        ap = pending(wf)
        if not ap or ap["step"] == stop_step:
            return wf
        await decide(client, headers, ap["id"])
    return await workflow_for(client, headers, vehicle)


async def close_work_order(client, shop_headers, wf: dict) -> None:
    """The shop starts work, then closes the work order (closing an open work order is refused)."""
    wo_id = wf["checkpoint"]["work_order"]["work_order_id"]
    r = await client.post(f"/products/asset-mgmt/work-orders/{wo_id}/start", json={}, headers=shop_headers)
    assert r.status_code == 200, r.text
    r = await client.post(f"/products/asset-mgmt/work-orders/{wo_id}/close", json={"resolution": "Fixed in test"}, headers=shop_headers)
    assert r.status_code == 200, r.text
    await bus.drain()

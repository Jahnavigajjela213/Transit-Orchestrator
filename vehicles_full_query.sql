-- One row per vehicle with every detail, joined across all systems via identity_crosswalk
SELECT t.code AS agency, c.label AS vehicle,
       am.external_id AS asset_number, tm.external_id AS trip_mgmt_code, tl.external_id AS telematics_device, sf.external_id AS safety_ref,
       a.make, a.model, a.year, a.vin, a.odometer, a.last_pm_date, a.last_pm_odometer, a.pm_interval_miles,
       (a.odometer - a.last_pm_odometer - a.pm_interval_miles) AS pm_miles_over, a.status AS asset_status,
       v.vehicle_type, v.capacity, v.wheelchair_positions, v.depot, v.status AS schedule_status,
       d.firmware, d.online,
       r.ts AS last_reading_at, r.engine_temp_c, r.oil_pressure_kpa, r.battery_v, r.speed_kph, r.dtc_codes,
       (SELECT count(*) FROM am_work_orders w WHERE w.asset_number = am.external_id AND w.status IN ('open','in_progress')) AS open_work_orders,
       (SELECT count(*) FROM sf_defects f WHERE f.vehicle_ref = sf.external_id AND f.status = 'open') AS open_defects,
       (SELECT max(b."end") FROM tm_availability_blocks b WHERE b.vehicle_code = tm.external_id AND b.active) AS blocked_until
FROM canonical_entities c
JOIN tenants t ON t.id = c.tenant_id
LEFT JOIN identity_crosswalk am ON am.canonical_id = c.id AND am.system = 'asset_mgmt'
LEFT JOIN identity_crosswalk tm ON tm.canonical_id = c.id AND tm.system = 'trip_mgmt'
LEFT JOIN identity_crosswalk tl ON tl.canonical_id = c.id AND tl.system = 'telematics'
LEFT JOIN identity_crosswalk sf ON sf.canonical_id = c.id AND sf.system = 'safety'
LEFT JOIN am_assets a   ON a.asset_number = am.external_id
LEFT JOIN tm_vehicles v ON v.vehicle_code = tm.external_id
LEFT JOIN tl_devices d  ON d.device_id = tl.external_id
LEFT JOIN LATERAL (SELECT * FROM tl_readings x WHERE x.device_id = tl.external_id ORDER BY x.ts DESC LIMIT 1) r ON true
WHERE c.entity_type = 'vehicle'
ORDER BY t.code, c.label
;

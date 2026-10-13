-- All vehicle data from transit_orchestrator (MVT + LSP), exported 2026-10-12 22:24
-- Tables: tenants am_assets am_work_orders am_shop_capacity am_fault_codes tm_vehicles tm_availability_blocks tl_devices tl_readings sf_defects, canonical_entities (vehicles), identity_crosswalk (vehicles)
BEGIN;

-- ===== TABLE CREATION =====
CREATE TABLE IF NOT EXISTS public.am_assets (
    asset_number character varying(30) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    unit_label character varying(20) NOT NULL,
    make character varying(40) NOT NULL,
    model character varying(40) NOT NULL,
    year integer NOT NULL,
    vin character varying(20) NOT NULL,
    odometer integer NOT NULL,
    last_pm_date date NOT NULL,
    last_pm_odometer integer NOT NULL,
    pm_interval_miles integer NOT NULL,
    status character varying(20) NOT NULL,
    depot character varying(40) NOT NULL
);
CREATE TABLE IF NOT EXISTS public.am_fault_codes (
    code character varying(20) NOT NULL,
    description character varying(200) NOT NULL,
    system character varying(40) NOT NULL,
    severity character varying(20) NOT NULL,
    est_repair_hours integer NOT NULL,
    affects_accessibility boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS public.am_shop_capacity (
    id character varying(40) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    depot character varying(40) NOT NULL,
    day date NOT NULL,
    bays_total integer NOT NULL,
    bays_booked integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.am_work_orders (
    id character varying(30) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    asset_number character varying(30) NOT NULL,
    status character varying(20) NOT NULL,
    priority character varying(20) NOT NULL,
    fault_code character varying(20),
    title character varying(200) NOT NULL,
    description text NOT NULL,
    source character varying(30) NOT NULL,
    shop_depot character varying(40),
    shop_start timestamp without time zone,
    shop_end timestamp without time zone,
    external_ref character varying(60),
    created_by character varying(120) NOT NULL,
    created_at timestamp without time zone NOT NULL,
    closed_at timestamp without time zone,
    closed_by character varying(120),
    resolution text
);
CREATE TABLE IF NOT EXISTS public.canonical_entities (
    id character varying(40) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    entity_type character varying(20) NOT NULL,
    label character varying(80) NOT NULL
);
CREATE TABLE IF NOT EXISTS public.identity_crosswalk (
    id character varying(40) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    entity_type character varying(20) NOT NULL,
    canonical_id character varying(40) NOT NULL,
    system character varying(30) NOT NULL,
    external_id character varying(60) NOT NULL
);
CREATE TABLE IF NOT EXISTS public.sf_defects (
    id character varying(30) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    vehicle_ref character varying(30) NOT NULL,
    category character varying(40) NOT NULL,
    severity character varying(20) NOT NULL,
    description text NOT NULL,
    status character varying(20) NOT NULL,
    out_of_service boolean NOT NULL,
    source character varying(30) NOT NULL,
    external_ref character varying(60),
    work_order_id character varying(30),
    created_by character varying(120) NOT NULL,
    created_at timestamp without time zone NOT NULL,
    closed_at timestamp without time zone,
    closed_by character varying(120),
    resolution text
);
CREATE TABLE IF NOT EXISTS public.tenants (
    id character varying(40) NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(120) NOT NULL,
    timezone character varying(60) NOT NULL,
    agent_persona character varying(60) NOT NULL,
    created_at timestamp without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tl_devices (
    device_id character varying(30) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    firmware character varying(20) NOT NULL,
    online boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tl_readings (
    id character varying(40) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    device_id character varying(30) NOT NULL,
    ts timestamp without time zone NOT NULL,
    engine_temp_c double precision NOT NULL,
    oil_pressure_kpa double precision NOT NULL,
    battery_v double precision NOT NULL,
    speed_kph double precision NOT NULL,
    odometer integer NOT NULL,
    dtc_codes json NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tm_availability_blocks (
    id character varying(40) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    vehicle_code character varying(30) NOT NULL,
    start timestamp without time zone NOT NULL,
    "end" timestamp without time zone NOT NULL,
    reason character varying(200) NOT NULL,
    source_ref character varying(60),
    active boolean NOT NULL,
    created_at timestamp without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tm_vehicles (
    vehicle_code character varying(30) NOT NULL,
    tenant_id character varying(40) NOT NULL,
    label character varying(20) NOT NULL,
    vehicle_type character varying(30) NOT NULL,
    capacity integer NOT NULL,
    wheelchair_positions integer NOT NULL,
    depot character varying(40) NOT NULL,
    status character varying(20) NOT NULL
);
ALTER TABLE ONLY public.am_assets
    ADD CONSTRAINT am_assets_pkey PRIMARY KEY (asset_number);
ALTER TABLE ONLY public.am_fault_codes
    ADD CONSTRAINT am_fault_codes_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.am_shop_capacity
    ADD CONSTRAINT am_shop_capacity_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.am_work_orders
    ADD CONSTRAINT am_work_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.canonical_entities
    ADD CONSTRAINT canonical_entities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.identity_crosswalk
    ADD CONSTRAINT identity_crosswalk_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.identity_crosswalk
    ADD CONSTRAINT identity_crosswalk_tenant_id_system_external_id_key UNIQUE (tenant_id, system, external_id);
ALTER TABLE ONLY public.sf_defects
    ADD CONSTRAINT sf_defects_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_code_key UNIQUE (code);
ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tl_devices
    ADD CONSTRAINT tl_devices_pkey PRIMARY KEY (device_id);
ALTER TABLE ONLY public.tl_readings
    ADD CONSTRAINT tl_readings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tm_availability_blocks
    ADD CONSTRAINT tm_availability_blocks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tm_vehicles
    ADD CONSTRAINT tm_vehicles_pkey PRIMARY KEY (vehicle_code);
CREATE INDEX IF NOT EXISTS ix_am_assets_tenant_id ON public.am_assets USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_am_shop_capacity_tenant_id ON public.am_shop_capacity USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_am_work_orders_asset_number ON public.am_work_orders USING btree (asset_number);
CREATE INDEX IF NOT EXISTS ix_am_work_orders_tenant_id ON public.am_work_orders USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_canonical_entities_entity_type ON public.canonical_entities USING btree (entity_type);
CREATE INDEX IF NOT EXISTS ix_canonical_entities_tenant_id ON public.canonical_entities USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_identity_crosswalk_canonical_id ON public.identity_crosswalk USING btree (canonical_id);
CREATE INDEX IF NOT EXISTS ix_identity_crosswalk_tenant_id ON public.identity_crosswalk USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_sf_defects_tenant_id ON public.sf_defects USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_sf_defects_vehicle_ref ON public.sf_defects USING btree (vehicle_ref);
CREATE INDEX IF NOT EXISTS ix_tl_devices_tenant_id ON public.tl_devices USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_tl_readings_device_id ON public.tl_readings USING btree (device_id);
CREATE INDEX IF NOT EXISTS ix_tl_readings_tenant_id ON public.tl_readings USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_tl_readings_ts ON public.tl_readings USING btree (ts);
CREATE INDEX IF NOT EXISTS ix_tm_availability_blocks_tenant_id ON public.tm_availability_blocks USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS ix_tm_availability_blocks_vehicle_code ON public.tm_availability_blocks USING btree (vehicle_code);
CREATE INDEX IF NOT EXISTS ix_tm_vehicles_tenant_id ON public.tm_vehicles USING btree (tenant_id);
ALTER TABLE ONLY public.canonical_entities
    ADD CONSTRAINT canonical_entities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
ALTER TABLE ONLY public.identity_crosswalk
    ADD CONSTRAINT identity_crosswalk_canonical_id_fkey FOREIGN KEY (canonical_id) REFERENCES public.canonical_entities(id);
ALTER TABLE ONLY public.identity_crosswalk
    ADD CONSTRAINT identity_crosswalk_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

-- ===== DATA =====
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-19797', 'ten_mvt', 'V-101', 'Gillig', 'Low Floor 40', 2015, '1F575043098952809', 93736, '2026-09-28', 88869, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-19894', 'ten_mvt', 'V-102', 'Gillig', 'Low Floor 40', 2020, '1F605763410660320', 144248, '2026-08-28', 139384, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20088', 'ten_mvt', 'V-104', 'Gillig', 'Low Floor 40', 2021, '1F240542222941829', 178685, '2026-08-15', 177930, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20185', 'ten_mvt', 'V-105', 'Gillig', 'Low Floor 40', 2017, '1F178313164820976', 229600, '2026-09-27', 224471, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20282', 'ten_mvt', 'V-106', 'Gillig', 'Low Floor 40', 2020, '1F610492416755513', 162049, '2026-08-17', 160822, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20379', 'ten_mvt', 'V-107', 'Gillig', 'Low Floor 40', 2024, '1F701386350788097', 77435, '2026-09-01', 72045, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20476', 'ten_mvt', 'V-108', 'Gillig', 'Low Floor 40', 2014, '1F551668705642492', 155141, '2026-08-29', 152085, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20573', 'ten_mvt', 'V-109', 'Gillig', 'Low Floor 40', 2024, '1F545441792384689', 204981, '2026-08-05', 202840, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20670', 'ten_mvt', 'V-110', 'Gillig', 'Low Floor 40', 2020, '1F757000708421749', 177752, '2026-08-12', 172564, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20767', 'ten_mvt', 'V-111', 'Gillig', 'Low Floor 40', 2015, '1F806441172261855', 87662, '2026-09-12', 86877, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20864', 'ten_mvt', 'V-112', 'Gillig', 'Low Floor 40', 2018, '1F722877507884985', 285392, '2026-10-01', 280658, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-20961', 'ten_mvt', 'V-113', 'New Flyer', 'Xcelsior 35', 2015, '1F589502978265864', 179893, '2026-09-12', 176707, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21058', 'ten_mvt', 'V-114', 'New Flyer', 'Xcelsior 35', 2022, '1F219807737461359', 302451, '2026-08-25', 300588, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21155', 'ten_mvt', 'V-115', 'New Flyer', 'Xcelsior 35', 2022, '1F100643895026653', 124698, '2026-08-22', 119880, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21252', 'ten_mvt', 'V-116', 'New Flyer', 'Xcelsior 35', 2014, '1F196435238956039', 201225, '2026-08-01', 198864, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21349', 'ten_mvt', 'V-117', 'New Flyer', 'Xcelsior 35', 2022, '1F398427921842859', 107314, '2026-07-27', 103021, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21446', 'ten_mvt', 'V-118', 'New Flyer', 'Xcelsior 35', 2020, '1F856253525679038', 145461, '2026-08-16', 142508, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21543', 'ten_mvt', 'V-119', 'Ford', 'E-450 ElDorado', 2014, '1F723661842916962', 73568, '2026-09-03', 70399, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21640', 'ten_mvt', 'V-120', 'Ford', 'E-450 ElDorado', 2014, '1F472029464318145', 160031, '2026-09-23', 159079, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21737', 'ten_mvt', 'V-121', 'Ford', 'E-450 ElDorado', 2023, '1F373591446861817', 109369, '2026-08-03', 104292, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21834', 'ten_mvt', 'V-122', 'Ford', 'E-450 ElDorado', 2020, '1F160991666960154', 225753, '2026-09-20', 221884, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-22028', 'ten_mvt', 'V-124', 'Ford', 'Transit Braun', 2022, '1F156955981827045', 79523, '2026-07-25', 75493, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-22125', 'ten_mvt', 'V-125', 'Ford', 'Transit Braun', 2020, '1F641962534058519', 163930, '2026-09-05', 162168, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-19991', 'ten_mvt', 'V-103', 'Gillig', 'Low Floor 40', 2018, '1F342421506867504', 261571, '2026-07-09', 255151, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-21931', 'ten_mvt', 'V-123', 'Ford', 'Transit Braun', 2017, '1F605094752306660', 170367, '2026-07-09', 162517, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-22222', 'ten_mvt', 'V-126', 'Ford', 'Transit Braun', 2021, '1F576261558654962', 244693, '2026-08-01', 242121, 6000, 'in_shop', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-29497', 'ten_lsp', 'P-201', 'New Flyer', 'Xcelsior 35', 2023, '1F507232797117714', 246884, '2026-08-29', 246168, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-29594', 'ten_lsp', 'P-202', 'New Flyer', 'Xcelsior 35', 2018, '1F843968086514365', 46469, '2026-08-22', 45051, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-29691', 'ten_lsp', 'P-203', 'Ford', 'E-450 ElDorado', 2021, '1F640664908828727', 270639, '2026-09-05', 270167, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-29885', 'ten_lsp', 'P-205', 'Ford', 'E-450 ElDorado', 2024, '1F361963153228013', 117018, '2026-09-18', 111556, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-29982', 'ten_lsp', 'P-206', 'Ford', 'E-450 ElDorado', 2022, '1F356653146767624', 206374, '2026-09-25', 205631, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30079', 'ten_lsp', 'P-207', 'Ford', 'E-450 ElDorado', 2014, '1F364246147385581', 225249, '2026-08-19', 220422, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30176', 'ten_lsp', 'P-208', 'Ford', 'Transit Braun', 2019, '1F518113221001154', 164245, '2026-08-10', 162174, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30273', 'ten_lsp', 'P-209', 'Ford', 'Transit Braun', 2019, '1F521893142743887', 211201, '2026-08-03', 205829, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30370', 'ten_lsp', 'P-210', 'Ford', 'Transit Braun', 2016, '1F765663717801118', 63388, '2026-09-29', 60606, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30467', 'ten_lsp', 'P-211', 'Ford', 'Transit Braun', 2019, '1F341922364925355', 306433, '2026-08-15', 301270, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30564', 'ten_lsp', 'P-212', 'Ford', 'Transit Braun', 2017, '1F666886571849198', 81127, '2026-07-24', 80094, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30661', 'ten_lsp', 'P-213', 'Ford', 'Transit Braun', 2023, '1F842189557256269', 316696, '2026-07-27', 315875, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30758', 'ten_lsp', 'P-214', 'Ford', 'Transit Braun', 2019, '1F999599124008444', 193650, '2026-08-17', 191251, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30855', 'ten_lsp', 'P-215', 'Ford', 'Transit Braun', 2020, '1F189723421081201', 166377, '2026-08-18', 162332, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-30952', 'ten_lsp', 'P-216', 'Ford', 'Transit Braun', 2020, '1F741020560786575', 160769, '2026-09-16', 156692, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-31146', 'ten_lsp', 'P-218', 'Ford', 'Transit Braun', 2017, '1F302567407504067', 299103, '2026-08-05', 293521, 6000, 'active', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-31243', 'ten_lsp', 'P-219', 'Ford', 'Transit Braun', 2016, '1F138366382184976', 286342, '2026-08-08', 285115, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-29788', 'ten_lsp', 'P-204', 'Ford', 'E-450 ElDorado', 2021, '1F390486590349599', 204640, '2026-07-09', 198220, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-31049', 'ten_lsp', 'P-217', 'Ford', 'Transit Braun', 2018, '1F423006433670962', 112425, '2026-07-09', 104575, 6000, 'active', 'South Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_assets (asset_number, tenant_id, unit_label, make, model, year, vin, odometer, last_pm_date, last_pm_odometer, pm_interval_miles, status, depot) VALUES ('FA-31340', 'ten_lsp', 'P-220', 'Ford', 'Transit Braun', 2020, '1F243500674324658', 317510, '2026-08-12', 313931, 6000, 'in_shop', 'North Yard') ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('P0217', 'Engine coolant over-temperature', 'Engine', 'critical', 10, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('BRK-02', 'Brake pad wear below minimum', 'Brakes', 'critical', 6, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('P0520', 'Oil pressure sensor circuit', 'Engine', 'high', 5, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('C1201', 'ABS control system malfunction', 'Brakes', 'high', 8, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('P0300', 'Random or multiple cylinder misfire', 'Engine', 'high', 12, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('LIFT-01', 'Wheelchair lift hydraulic fault', 'Accessibility', 'high', 6, true) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('B1342', 'ECU internal fault', 'Electrical', 'medium', 6, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('U0100', 'Lost communication with ECM', 'Electrical', 'medium', 4, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('HVAC-05', 'HVAC compressor clutch circuit', 'Comfort', 'medium', 5, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('P0420', 'Catalyst efficiency below threshold', 'Emissions', 'low', 4, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('TPMS-1', 'Tire pressure sensor fault', 'Chassis', 'low', 2, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_fault_codes (code, description, system, severity, est_repair_hours, affects_accessibility) VALUES ('PM-DUE', 'Preventive maintenance overdue', 'Maintenance', 'medium', 4, false) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_6ca23e8e632b', 'ten_mvt', 'North Yard', '2026-10-11', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_8a4776adef00', 'ten_mvt', 'South Yard', '2026-10-11', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_d51c04974552', 'ten_mvt', 'North Yard', '2026-10-12', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_02cc8ab097ec', 'ten_mvt', 'South Yard', '2026-10-12', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_04b46b85ddb4', 'ten_mvt', 'North Yard', '2026-10-13', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_4ce7f8638258', 'ten_mvt', 'South Yard', '2026-10-13', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_29d2f5f6f9b5', 'ten_mvt', 'North Yard', '2026-10-14', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_0f331982e543', 'ten_mvt', 'South Yard', '2026-10-14', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_596d991ad613', 'ten_mvt', 'North Yard', '2026-10-15', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_7443c99b1692', 'ten_mvt', 'South Yard', '2026-10-15', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_f281a28d3cfe', 'ten_mvt', 'North Yard', '2026-10-16', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_4fbcd3a4fb95', 'ten_mvt', 'South Yard', '2026-10-16', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_8549e76b8a0e', 'ten_mvt', 'North Yard', '2026-10-17', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_6f49b48b070d', 'ten_mvt', 'South Yard', '2026-10-17', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_2961a0a0c402', 'ten_mvt', 'North Yard', '2026-10-18', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_08b456851978', 'ten_mvt', 'South Yard', '2026-10-18', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_748a03fb6f07', 'ten_mvt', 'North Yard', '2026-10-19', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_eb1d13fd59cd', 'ten_mvt', 'South Yard', '2026-10-19', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_fa315c54362f', 'ten_mvt', 'North Yard', '2026-10-20', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_e145651a33db', 'ten_mvt', 'South Yard', '2026-10-20', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_42281f1339e7', 'ten_mvt', 'North Yard', '2026-10-21', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_4945c91c6c07', 'ten_mvt', 'South Yard', '2026-10-21', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_ef06eb34d7c9', 'ten_mvt', 'North Yard', '2026-10-22', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_ee8c55dd7541', 'ten_mvt', 'South Yard', '2026-10-22', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_6ce503c5107a', 'ten_mvt', 'North Yard', '2026-10-23', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_4952c8dccb4f', 'ten_mvt', 'South Yard', '2026-10-23', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_466f59462a56', 'ten_mvt', 'North Yard', '2026-10-24', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_69432a71b6a8', 'ten_mvt', 'South Yard', '2026-10-24', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_c9620e410944', 'ten_mvt', 'North Yard', '2026-10-25', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_fe848026c22d', 'ten_mvt', 'South Yard', '2026-10-25', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_e4d447090b4e', 'ten_mvt', 'North Yard', '2026-10-26', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_562d6ca333c9', 'ten_mvt', 'South Yard', '2026-10-26', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_9d704ff027aa', 'ten_lsp', 'North Yard', '2026-10-11', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_63fb1f58a944', 'ten_lsp', 'South Yard', '2026-10-11', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_d81187ba33a4', 'ten_lsp', 'South Yard', '2026-10-12', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_4affc4fa474e', 'ten_lsp', 'North Yard', '2026-10-13', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_add0abc2c69b', 'ten_lsp', 'South Yard', '2026-10-13', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_0b00a78b97a2', 'ten_lsp', 'North Yard', '2026-10-14', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_02b50c497a5f', 'ten_lsp', 'South Yard', '2026-10-14', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_c2a0eac204e2', 'ten_lsp', 'North Yard', '2026-10-15', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_d8e194d1b2df', 'ten_lsp', 'South Yard', '2026-10-15', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_2c49066c4966', 'ten_lsp', 'North Yard', '2026-10-16', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_cbbb1ff73d9e', 'ten_lsp', 'South Yard', '2026-10-16', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_bef6a7badeff', 'ten_lsp', 'North Yard', '2026-10-17', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_fc1022fd03a7', 'ten_lsp', 'South Yard', '2026-10-17', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_912ceb579d10', 'ten_lsp', 'North Yard', '2026-10-18', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_934e8c64ea99', 'ten_lsp', 'South Yard', '2026-10-18', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_44b2995b3c3e', 'ten_lsp', 'North Yard', '2026-10-19', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_e0218deb5f02', 'ten_lsp', 'South Yard', '2026-10-19', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_9f99a813f51c', 'ten_lsp', 'North Yard', '2026-10-20', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_497baaf437c2', 'ten_lsp', 'South Yard', '2026-10-20', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_712ceb845d38', 'ten_lsp', 'North Yard', '2026-10-21', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_364443956c2e', 'ten_lsp', 'South Yard', '2026-10-21', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_d7f340b18ccd', 'ten_lsp', 'North Yard', '2026-10-22', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_4c06f99239ae', 'ten_lsp', 'South Yard', '2026-10-22', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_026f555cf3f3', 'ten_lsp', 'North Yard', '2026-10-23', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_ccdb4d8f6d06', 'ten_lsp', 'South Yard', '2026-10-23', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_fce139519f6f', 'ten_lsp', 'North Yard', '2026-10-24', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_3ddee029dcd5', 'ten_lsp', 'South Yard', '2026-10-24', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_db3f80ac6fae', 'ten_lsp', 'North Yard', '2026-10-25', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_ce4110efe467', 'ten_lsp', 'South Yard', '2026-10-25', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_9f32594ca5b6', 'ten_lsp', 'North Yard', '2026-10-26', 3, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_9ac000aacc7e', 'ten_lsp', 'South Yard', '2026-10-26', 2, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.am_shop_capacity (id, tenant_id, depot, day, bays_total, bays_booked) VALUES ('cap_492086049372', 'ten_lsp', 'North Yard', '2026-10-12', 3, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.am_work_orders (id, tenant_id, asset_number, status, priority, fault_code, title, description, source, shop_depot, shop_start, shop_end, external_ref, created_by, created_at, closed_at, closed_by, resolution) VALUES ('WO-2026-MVT01', 'ten_mvt', 'FA-22222', 'in_progress', 'high', 'HVAC-05', 'HVAC compressor replacement', 'Reported by operator; parts on order.', 'manual', 'South Yard', '2026-10-11 08:00:00', '2026-10-13 17:00:00', NULL, 'Shop', '2026-10-11 17:02:04', NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.am_work_orders (id, tenant_id, asset_number, status, priority, fault_code, title, description, source, shop_depot, shop_start, shop_end, external_ref, created_by, created_at, closed_at, closed_by, resolution) VALUES ('WO-2026-LSP01', 'ten_lsp', 'FA-31340', 'in_progress', 'high', 'HVAC-05', 'HVAC compressor replacement', 'Reported by operator; parts on order.', 'manual', 'North Yard', '2026-10-11 08:00:00', '2026-10-13 17:00:00', NULL, 'Shop', '2026-10-11 17:02:04', NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.am_work_orders (id, tenant_id, asset_number, status, priority, fault_code, title, description, source, shop_depot, shop_start, shop_end, external_ref, created_by, created_at, closed_at, closed_by, resolution) VALUES ('WO-2026-00003', 'ten_lsp', 'FA-29497', 'open', 'critical', 'BRK-02', 'Brake pad wear below minimum (BRK-02)', 'Opened by orchestrator from vehicle.fault.detected. P-201 reported brake pad wear below minimum (BRK-02), rated critical. Continuing service risks a road call or safety incident, so the vehicle should come out of service. Recommended shop window: Mon 12 Oct 17:03 to Tue 13 Oct 01:03 at North Yard. 1 run(s) fall inside that window, carrying 8 booked riders. A spare vehicle and a qualified driver were found for every affected run.', 'orchestrator', 'North Yard', '2026-10-12 17:03:05', '2026-10-13 01:03:05', 'wf_2f275301933b', 'lsp-orchestrator-agent/asset', '2026-10-12 17:03:05', NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.am_work_orders (id, tenant_id, asset_number, status, priority, fault_code, title, description, source, shop_depot, shop_start, shop_end, external_ref, created_by, created_at, closed_at, closed_by, resolution) VALUES ('WO-2026-00004', 'ten_lsp', 'FA-29691', 'closed', 'critical', 'P0217', 'Engine coolant over-temperature (P0217)', 'Opened by orchestrator from vehicle.fault.detected. P-203 reported engine coolant over-temperature (P0217), rated critical. Continuing service risks a road call or safety incident, so the vehicle should come out of service. Recommended shop window: Mon 12 Oct 17:03 to Wed 14 Oct 17:03 at North Yard. 5 run(s) fall inside that window, carrying 37 booked riders. A spare vehicle and a qualified driver were found for every affected run.', 'orchestrator', 'North Yard', '2026-10-12 17:03:58', '2026-10-14 17:03:58', 'wf_faf006825f30', 'lsp-orchestrator-agent/asset', '2026-10-12 17:04:10', '2026-10-12 18:01:36', 'Tom Haddad', 'Repaired and road tested') ON CONFLICT DO NOTHING;
INSERT INTO public.sf_defects (id, tenant_id, vehicle_ref, category, severity, description, status, out_of_service, source, external_ref, work_order_id, created_by, created_at, closed_at, closed_by, resolution) VALUES ('DEF-2026-00001', 'ten_lsp', 'VS-V201L', 'Brakes', 'critical', 'Brake pad wear below minimum (BRK-02). Work order WO-2026-00003.', 'open', true, 'orchestrator', 'wf_2f275301933b', 'WO-2026-00003', 'lsp-orchestrator-agent/safety', '2026-10-12 17:03:06', NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.sf_defects (id, tenant_id, vehicle_ref, category, severity, description, status, out_of_service, source, external_ref, work_order_id, created_by, created_at, closed_at, closed_by, resolution) VALUES ('DEF-2026-00002', 'ten_lsp', 'VS-V203L', 'Engine', 'critical', 'Engine coolant over-temperature (P0217). Work order WO-2026-00004.', 'open', true, 'orchestrator', 'wf_faf006825f30', 'WO-2026-00004', 'lsp-orchestrator-agent/safety', '2026-10-12 17:04:10', NULL, NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, code, name, timezone, agent_persona, created_at) VALUES ('ten_mvt', 'MVT', 'Metro Valley Transit', 'America/Los_Angeles', 'mvt-orchestrator-agent', '2026-10-12 17:02:04') ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, code, name, timezone, agent_persona, created_at) VALUES ('ten_lsp', 'LSP', 'Lakeshore Paratransit', 'America/Los_Angeles', 'lsp-orchestrator-agent', '2026-10-12 17:02:05') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-CC89', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-16CB', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-C2B9', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-680D', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-F2AC', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-EAF6', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-C3AA', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-B3D7', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-C7C9', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-99FA', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-8E57', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-71B1', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-D039', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-536D', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-6FB8', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-E4E8', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-3031', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-9A0F', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-4985', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-1F12', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-9A0B', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-7E59', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-2BF9', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-FC5B', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-E944', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-108D', 'ten_mvt', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-6668', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-ABA5', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-146B', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-F5A4', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-3CAB', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-80B8', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-1420', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-23D3', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-1652', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-6E49', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-C73C', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-718F', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-F0E4', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-A343', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-C16D', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-8BF1', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-BC92', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-35FD', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-9DF8', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_devices (device_id, tenant_id, firmware, online) VALUES ('TLM-93D0', 'ten_lsp', '4.2.1', true) ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_dd4514d0d3a0', 'ten_mvt', 'TLM-CC89', '2026-10-12 17:02:04', 84.3, 276.2, 13.36, 0, 93736, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_29ab1db1d571', 'ten_mvt', 'TLM-16CB', '2026-10-12 17:02:04', 92.9, 250.8, 13.81, 0, 144248, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_a9c7ad19e2b8', 'ten_mvt', 'TLM-C2B9', '2026-10-12 17:02:04', 85.1, 295.6, 13.14, 0, 261571, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_46bcd56c2a97', 'ten_mvt', 'TLM-680D', '2026-10-12 17:02:04', 84.9, 285.2, 13.54, 0, 178685, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_e31c25e607c5', 'ten_mvt', 'TLM-F2AC', '2026-10-12 17:02:04', 91.3, 342.8, 14.08, 0, 229600, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_9712d5a0402f', 'ten_mvt', 'TLM-EAF6', '2026-10-12 17:02:04', 85.8, 292.6, 13.61, 0, 162049, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_8056a38d0603', 'ten_mvt', 'TLM-C3AA', '2026-10-12 17:02:04', 85.8, 295.5, 14.08, 0, 77435, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_e8103373db3e', 'ten_mvt', 'TLM-B3D7', '2026-10-12 17:02:04', 84.7, 359.6, 13.45, 0, 155141, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_dd5016e1a6ce', 'ten_mvt', 'TLM-C7C9', '2026-10-12 17:02:04', 85.6, 266.8, 13.72, 0, 204981, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_468c53128b85', 'ten_mvt', 'TLM-99FA', '2026-10-12 17:02:04', 88, 369.7, 12.81, 0, 177752, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_333ebc6c827e', 'ten_mvt', 'TLM-8E57', '2026-10-12 17:02:04', 92.7, 300.7, 12.7, 0, 87662, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_c1b980a2e77c', 'ten_mvt', 'TLM-71B1', '2026-10-12 17:02:04', 91.5, 263.7, 13.93, 0, 285392, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_58eb0e26c0e4', 'ten_mvt', 'TLM-D039', '2026-10-12 17:02:04', 89, 364.5, 13.91, 0, 179893, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_9135be0b0d6f', 'ten_mvt', 'TLM-536D', '2026-10-12 17:02:04', 93.3, 310.9, 12.9, 0, 302451, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_a2f04ad65aa4', 'ten_mvt', 'TLM-6FB8', '2026-10-12 17:02:04', 89.4, 263.4, 13.14, 0, 124698, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_d2db727cbf31', 'ten_mvt', 'TLM-E4E8', '2026-10-12 17:02:04', 93, 367.4, 13.4, 0, 201225, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_e1dae956832b', 'ten_mvt', 'TLM-3031', '2026-10-12 17:02:04', 93.6, 300.8, 12.92, 0, 107314, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_6e0bc55c096a', 'ten_mvt', 'TLM-9A0F', '2026-10-12 17:02:04', 88.8, 312.1, 12.78, 0, 145461, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_0af0ee297f78', 'ten_mvt', 'TLM-4985', '2026-10-12 17:02:04', 90.5, 250.9, 13.66, 0, 73568, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_dde42f0342d7', 'ten_mvt', 'TLM-1F12', '2026-10-12 17:02:04', 89.7, 283.4, 13.33, 0, 160031, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_258de3700e62', 'ten_mvt', 'TLM-9A0B', '2026-10-12 17:02:04', 92.9, 272.8, 12.75, 0, 109369, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_ad19819846cf', 'ten_mvt', 'TLM-7E59', '2026-10-12 17:02:04', 84.7, 337.4, 13.8, 0, 225753, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_71e223f9a721', 'ten_mvt', 'TLM-2BF9', '2026-10-12 17:02:04', 88.6, 283.4, 12.97, 0, 170367, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_f8605302237a', 'ten_mvt', 'TLM-FC5B', '2026-10-12 17:02:04', 93.2, 366.3, 13.99, 0, 79523, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_8eca1964f634', 'ten_mvt', 'TLM-E944', '2026-10-12 17:02:04', 93.5, 358.3, 12.85, 0, 163930, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_0bf6291e08dd', 'ten_mvt', 'TLM-108D', '2026-10-12 17:02:04', 85.7, 285.6, 14.05, 0, 244693, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_ee6db7c49bd7', 'ten_lsp', 'TLM-6668', '2026-10-12 17:02:04', 91.3, 343.9, 13.82, 0, 246884, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_b189dd0ad383', 'ten_lsp', 'TLM-ABA5', '2026-10-12 17:02:04', 93.2, 351.7, 13.27, 0, 46469, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_3ab371adb8ee', 'ten_lsp', 'TLM-146B', '2026-10-12 17:02:04', 88.5, 319.5, 12.72, 0, 270639, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_b5af442269bf', 'ten_lsp', 'TLM-F5A4', '2026-10-12 17:02:04', 86.9, 309.4, 12.94, 0, 204640, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_5aa1b0a50b15', 'ten_lsp', 'TLM-3CAB', '2026-10-12 17:02:04', 91.2, 272.1, 13.36, 0, 117018, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_b7613e518db4', 'ten_lsp', 'TLM-80B8', '2026-10-12 17:02:04', 94.5, 369, 14.06, 0, 206374, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_36e8f9e83186', 'ten_lsp', 'TLM-1420', '2026-10-12 17:02:04', 85.2, 310.8, 12.77, 0, 225249, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_6bec284e3b2b', 'ten_lsp', 'TLM-23D3', '2026-10-12 17:02:04', 84.8, 301.2, 13.02, 0, 164245, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_fcd6fb5a6a62', 'ten_lsp', 'TLM-1652', '2026-10-12 17:02:04', 94.4, 285.3, 12.65, 0, 211201, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_30f051656f4b', 'ten_lsp', 'TLM-6E49', '2026-10-12 17:02:04', 85.2, 275.4, 13.07, 0, 63388, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_913df1b44ef5', 'ten_lsp', 'TLM-C73C', '2026-10-12 17:02:04', 93.1, 253.9, 13.69, 0, 306433, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_c26cc2aac263', 'ten_lsp', 'TLM-718F', '2026-10-12 17:02:04', 92.1, 314.7, 12.78, 0, 81127, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_89dddc1a11a3', 'ten_lsp', 'TLM-F0E4', '2026-10-12 17:02:04', 89.7, 288, 12.89, 0, 316696, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_5f1c1febce81', 'ten_lsp', 'TLM-A343', '2026-10-12 17:02:04', 86.5, 287.8, 14.06, 0, 193650, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_f7239cd33849', 'ten_lsp', 'TLM-C16D', '2026-10-12 17:02:04', 90.2, 259.2, 13.14, 0, 166377, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_60e34b2d5645', 'ten_lsp', 'TLM-8BF1', '2026-10-12 17:02:04', 94.2, 279.4, 13.96, 0, 160769, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_3a60b053b4ce', 'ten_lsp', 'TLM-BC92', '2026-10-12 17:02:04', 87.5, 259.8, 13.23, 0, 112425, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_f0654eb4b6bd', 'ten_lsp', 'TLM-35FD', '2026-10-12 17:02:04', 84.2, 264.5, 13, 0, 299103, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_a4c3c41d513f', 'ten_lsp', 'TLM-9DF8', '2026-10-12 17:02:04', 84.3, 270, 12.71, 0, 286342, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_be5a3e565116', 'ten_lsp', 'TLM-93D0', '2026-10-12 17:02:04', 91.7, 279, 13.04, 0, 317510, '[]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_ea36358199fa', 'ten_lsp', 'TLM-6668', '2026-10-12 17:03:05', 85.6, 261.6, 13.07, 32.8, 246884, '["BRK-02"]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_de09a234b278', 'ten_lsp', 'TLM-146B', '2026-10-12 17:03:57', 116.7, 314, 13.88, 41, 270640, '["P0217"]') ON CONFLICT DO NOTHING;
INSERT INTO public.tl_readings (id, tenant_id, device_id, ts, engine_temp_c, oil_pressure_kpa, battery_v, speed_kph, odometer, dtc_codes) VALUES ('tlr_7d6b08eb870e', 'ten_lsp', 'TLM-6E49', '2026-10-12 17:15:01', 95.2, 302.9, 12.74, 18.2, 63390, '["C1201"]') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_availability_blocks (id, tenant_id, vehicle_code, start, "end", reason, source_ref, active, created_at) VALUES ('blk_18184d012e70', 'ten_mvt', 'TM-V126', '2026-10-11 08:00:00', '2026-10-13 17:00:00', 'Shop: HVAC compressor replacement', 'manual-V-126', true, '2026-10-12 17:02:05') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_availability_blocks (id, tenant_id, vehicle_code, start, "end", reason, source_ref, active, created_at) VALUES ('blk_1171c539dd50', 'ten_lsp', 'TM-P220', '2026-10-11 08:00:00', '2026-10-13 17:00:00', 'Shop: HVAC compressor replacement', 'manual-P-220', true, '2026-10-12 17:02:05') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_availability_blocks (id, tenant_id, vehicle_code, start, "end", reason, source_ref, active, created_at) VALUES ('blk_ca05adeb18de', 'ten_lsp', 'TM-P203', '2026-10-12 17:03:58', '2026-10-14 17:03:58', 'Shop: WO-2026-00004 Engine coolant over-temperature', 'wf_faf006825f30', true, '2026-10-12 17:04:18') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_availability_blocks (id, tenant_id, vehicle_code, start, "end", reason, source_ref, active, created_at) VALUES ('blk_96607835f25f', 'ten_lsp', 'TM-P201', '2026-10-12 17:03:05', '2026-10-13 01:03:05', 'Shop: WO-2026-00003 Brake pad wear below minimum', 'wf_2f275301933b', true, '2026-10-12 17:04:27') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V101', 'ten_mvt', 'V-101', '40ft Bus', 40, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V102', 'ten_mvt', 'V-102', '40ft Bus', 40, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V103', 'ten_mvt', 'V-103', '40ft Bus', 40, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V104', 'ten_mvt', 'V-104', '40ft Bus', 40, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V105', 'ten_mvt', 'V-105', '40ft Bus', 40, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V106', 'ten_mvt', 'V-106', '40ft Bus', 40, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V107', 'ten_mvt', 'V-107', '40ft Bus', 40, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V108', 'ten_mvt', 'V-108', '40ft Bus', 40, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V109', 'ten_mvt', 'V-109', '40ft Bus', 40, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V110', 'ten_mvt', 'V-110', '40ft Bus', 40, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V111', 'ten_mvt', 'V-111', '40ft Bus', 40, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V112', 'ten_mvt', 'V-112', '40ft Bus', 40, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V113', 'ten_mvt', 'V-113', '35ft Bus', 32, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V114', 'ten_mvt', 'V-114', '35ft Bus', 32, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V115', 'ten_mvt', 'V-115', '35ft Bus', 32, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V116', 'ten_mvt', 'V-116', '35ft Bus', 32, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V117', 'ten_mvt', 'V-117', '35ft Bus', 32, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V118', 'ten_mvt', 'V-118', '35ft Bus', 32, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V119', 'ten_mvt', 'V-119', 'Cutaway', 16, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V120', 'ten_mvt', 'V-120', 'Cutaway', 16, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V121', 'ten_mvt', 'V-121', 'Cutaway', 16, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V122', 'ten_mvt', 'V-122', 'Cutaway', 16, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V123', 'ten_mvt', 'V-123', 'Paratransit Van', 8, 3, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V124', 'ten_mvt', 'V-124', 'Paratransit Van', 8, 3, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V125', 'ten_mvt', 'V-125', 'Paratransit Van', 8, 3, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-V126', 'ten_mvt', 'V-126', 'Paratransit Van', 8, 3, 'South Yard', 'out_of_service') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P202', 'ten_lsp', 'P-202', '35ft Bus', 32, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P204', 'ten_lsp', 'P-204', 'Cutaway', 16, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P205', 'ten_lsp', 'P-205', 'Cutaway', 16, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P206', 'ten_lsp', 'P-206', 'Cutaway', 16, 2, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P207', 'ten_lsp', 'P-207', 'Cutaway', 16, 2, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P208', 'ten_lsp', 'P-208', 'Paratransit Van', 8, 3, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P209', 'ten_lsp', 'P-209', 'Paratransit Van', 8, 3, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P210', 'ten_lsp', 'P-210', 'Paratransit Van', 8, 3, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P211', 'ten_lsp', 'P-211', 'Paratransit Van', 8, 3, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P212', 'ten_lsp', 'P-212', 'Paratransit Van', 8, 3, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P213', 'ten_lsp', 'P-213', 'Paratransit Van', 8, 3, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P214', 'ten_lsp', 'P-214', 'Paratransit Van', 8, 3, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P215', 'ten_lsp', 'P-215', 'Paratransit Van', 8, 3, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P216', 'ten_lsp', 'P-216', 'Paratransit Van', 8, 3, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P217', 'ten_lsp', 'P-217', 'Paratransit Van', 8, 3, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P218', 'ten_lsp', 'P-218', 'Paratransit Van', 8, 3, 'North Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P219', 'ten_lsp', 'P-219', 'Paratransit Van', 8, 3, 'South Yard', 'available') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P220', 'ten_lsp', 'P-220', 'Paratransit Van', 8, 3, 'North Yard', 'out_of_service') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P203', 'ten_lsp', 'P-203', 'Cutaway', 16, 2, 'North Yard', 'out_of_service') ON CONFLICT DO NOTHING;
INSERT INTO public.tm_vehicles (vehicle_code, tenant_id, label, vehicle_type, capacity, wheelchair_positions, depot, status) VALUES ('TM-P201', 'ten_lsp', 'P-201', '35ft Bus', 32, 2, 'North Yard', 'out_of_service') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_201', 'ten_lsp', 'vehicle', 'P-201') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_202', 'ten_lsp', 'vehicle', 'P-202') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_203', 'ten_lsp', 'vehicle', 'P-203') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_204', 'ten_lsp', 'vehicle', 'P-204') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_205', 'ten_lsp', 'vehicle', 'P-205') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_206', 'ten_lsp', 'vehicle', 'P-206') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_207', 'ten_lsp', 'vehicle', 'P-207') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_208', 'ten_lsp', 'vehicle', 'P-208') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_209', 'ten_lsp', 'vehicle', 'P-209') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_210', 'ten_lsp', 'vehicle', 'P-210') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_211', 'ten_lsp', 'vehicle', 'P-211') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_212', 'ten_lsp', 'vehicle', 'P-212') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_213', 'ten_lsp', 'vehicle', 'P-213') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_214', 'ten_lsp', 'vehicle', 'P-214') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_215', 'ten_lsp', 'vehicle', 'P-215') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_216', 'ten_lsp', 'vehicle', 'P-216') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_217', 'ten_lsp', 'vehicle', 'P-217') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_218', 'ten_lsp', 'vehicle', 'P-218') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_219', 'ten_lsp', 'vehicle', 'P-219') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_lsp_220', 'ten_lsp', 'vehicle', 'P-220') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_101', 'ten_mvt', 'vehicle', 'V-101') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_102', 'ten_mvt', 'vehicle', 'V-102') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_103', 'ten_mvt', 'vehicle', 'V-103') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_104', 'ten_mvt', 'vehicle', 'V-104') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_105', 'ten_mvt', 'vehicle', 'V-105') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_106', 'ten_mvt', 'vehicle', 'V-106') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_107', 'ten_mvt', 'vehicle', 'V-107') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_108', 'ten_mvt', 'vehicle', 'V-108') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_109', 'ten_mvt', 'vehicle', 'V-109') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_110', 'ten_mvt', 'vehicle', 'V-110') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_111', 'ten_mvt', 'vehicle', 'V-111') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_112', 'ten_mvt', 'vehicle', 'V-112') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_113', 'ten_mvt', 'vehicle', 'V-113') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_114', 'ten_mvt', 'vehicle', 'V-114') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_115', 'ten_mvt', 'vehicle', 'V-115') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_116', 'ten_mvt', 'vehicle', 'V-116') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_117', 'ten_mvt', 'vehicle', 'V-117') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_118', 'ten_mvt', 'vehicle', 'V-118') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_119', 'ten_mvt', 'vehicle', 'V-119') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_120', 'ten_mvt', 'vehicle', 'V-120') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_121', 'ten_mvt', 'vehicle', 'V-121') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_122', 'ten_mvt', 'vehicle', 'V-122') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_123', 'ten_mvt', 'vehicle', 'V-123') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_124', 'ten_mvt', 'vehicle', 'V-124') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_125', 'ten_mvt', 'vehicle', 'V-125') ON CONFLICT DO NOTHING;
INSERT INTO public.canonical_entities (id, tenant_id, entity_type, label) VALUES ('veh_mvt_126', 'ten_mvt', 'vehicle', 'V-126') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_8f7767428d8a', 'ten_lsp', 'vehicle', 'veh_lsp_201', 'asset_mgmt', 'FA-29497') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_2a59267f70a1', 'ten_lsp', 'vehicle', 'veh_lsp_201', 'safety', 'VS-V201L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d480a00465d9', 'ten_lsp', 'vehicle', 'veh_lsp_201', 'telematics', 'TLM-6668') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_5226fff8fd1d', 'ten_lsp', 'vehicle', 'veh_lsp_201', 'trip_mgmt', 'TM-P201') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_c960c0deb82c', 'ten_lsp', 'vehicle', 'veh_lsp_202', 'asset_mgmt', 'FA-29594') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_467956902bb3', 'ten_lsp', 'vehicle', 'veh_lsp_202', 'safety', 'VS-V202L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_dd1120846c59', 'ten_lsp', 'vehicle', 'veh_lsp_202', 'telematics', 'TLM-ABA5') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_33b29de24136', 'ten_lsp', 'vehicle', 'veh_lsp_202', 'trip_mgmt', 'TM-P202') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_5f209ed09791', 'ten_lsp', 'vehicle', 'veh_lsp_203', 'asset_mgmt', 'FA-29691') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_18bc5cb406c2', 'ten_lsp', 'vehicle', 'veh_lsp_203', 'safety', 'VS-V203L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_33da774ac047', 'ten_lsp', 'vehicle', 'veh_lsp_203', 'telematics', 'TLM-146B') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e6345e3ebd4d', 'ten_lsp', 'vehicle', 'veh_lsp_203', 'trip_mgmt', 'TM-P203') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_deaf9942e190', 'ten_lsp', 'vehicle', 'veh_lsp_204', 'asset_mgmt', 'FA-29788') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f21b1b14bc30', 'ten_lsp', 'vehicle', 'veh_lsp_204', 'safety', 'VS-V204L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3b3e70482cf2', 'ten_lsp', 'vehicle', 'veh_lsp_204', 'telematics', 'TLM-F5A4') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_bf98a28ec3d5', 'ten_lsp', 'vehicle', 'veh_lsp_204', 'trip_mgmt', 'TM-P204') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_19b823b44e55', 'ten_lsp', 'vehicle', 'veh_lsp_205', 'asset_mgmt', 'FA-29885') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_fe6e4a6e2717', 'ten_lsp', 'vehicle', 'veh_lsp_205', 'safety', 'VS-V205L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_cd099c864d3c', 'ten_lsp', 'vehicle', 'veh_lsp_205', 'telematics', 'TLM-3CAB') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_a400c580ee1f', 'ten_lsp', 'vehicle', 'veh_lsp_205', 'trip_mgmt', 'TM-P205') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_919aee13bbd9', 'ten_lsp', 'vehicle', 'veh_lsp_206', 'asset_mgmt', 'FA-29982') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_159a605993c1', 'ten_lsp', 'vehicle', 'veh_lsp_206', 'safety', 'VS-V206L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_72aa0eea13ec', 'ten_lsp', 'vehicle', 'veh_lsp_206', 'telematics', 'TLM-80B8') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_75a9e35c1772', 'ten_lsp', 'vehicle', 'veh_lsp_206', 'trip_mgmt', 'TM-P206') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_963ba8405632', 'ten_lsp', 'vehicle', 'veh_lsp_207', 'asset_mgmt', 'FA-30079') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_525455d15d36', 'ten_lsp', 'vehicle', 'veh_lsp_207', 'safety', 'VS-V207L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_003637e37fb7', 'ten_lsp', 'vehicle', 'veh_lsp_207', 'telematics', 'TLM-1420') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_69d7f9799718', 'ten_lsp', 'vehicle', 'veh_lsp_207', 'trip_mgmt', 'TM-P207') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_45934e889b5e', 'ten_lsp', 'vehicle', 'veh_lsp_208', 'asset_mgmt', 'FA-30176') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_6d5db00f0ba8', 'ten_lsp', 'vehicle', 'veh_lsp_208', 'safety', 'VS-V208L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_257c41b05d50', 'ten_lsp', 'vehicle', 'veh_lsp_208', 'telematics', 'TLM-23D3') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_0e8d7ac31360', 'ten_lsp', 'vehicle', 'veh_lsp_208', 'trip_mgmt', 'TM-P208') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_1e0a47029a0c', 'ten_lsp', 'vehicle', 'veh_lsp_209', 'asset_mgmt', 'FA-30273') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_ff50e7d51858', 'ten_lsp', 'vehicle', 'veh_lsp_209', 'safety', 'VS-V209L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_442dda558ade', 'ten_lsp', 'vehicle', 'veh_lsp_209', 'telematics', 'TLM-1652') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_04b175834bc5', 'ten_lsp', 'vehicle', 'veh_lsp_209', 'trip_mgmt', 'TM-P209') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_a099986d7248', 'ten_lsp', 'vehicle', 'veh_lsp_210', 'asset_mgmt', 'FA-30370') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_c6b45321d1f9', 'ten_lsp', 'vehicle', 'veh_lsp_210', 'safety', 'VS-V210L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d9ff95f42851', 'ten_lsp', 'vehicle', 'veh_lsp_210', 'telematics', 'TLM-6E49') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_676476259162', 'ten_lsp', 'vehicle', 'veh_lsp_210', 'trip_mgmt', 'TM-P210') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_4a01e2ddf7e7', 'ten_lsp', 'vehicle', 'veh_lsp_211', 'asset_mgmt', 'FA-30467') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e1b7089e522c', 'ten_lsp', 'vehicle', 'veh_lsp_211', 'safety', 'VS-V211L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_bc5a5170cad3', 'ten_lsp', 'vehicle', 'veh_lsp_211', 'telematics', 'TLM-C73C') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_086764f9e04c', 'ten_lsp', 'vehicle', 'veh_lsp_211', 'trip_mgmt', 'TM-P211') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_7024b6df1036', 'ten_lsp', 'vehicle', 'veh_lsp_212', 'asset_mgmt', 'FA-30564') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_4f692f8bec09', 'ten_lsp', 'vehicle', 'veh_lsp_212', 'safety', 'VS-V212L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_7a02d2bed53b', 'ten_lsp', 'vehicle', 'veh_lsp_212', 'telematics', 'TLM-718F') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_8a566bd69275', 'ten_lsp', 'vehicle', 'veh_lsp_212', 'trip_mgmt', 'TM-P212') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_57e75a360825', 'ten_lsp', 'vehicle', 'veh_lsp_213', 'asset_mgmt', 'FA-30661') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_14ffdda1021a', 'ten_lsp', 'vehicle', 'veh_lsp_213', 'safety', 'VS-V213L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_c5e1ed3193a0', 'ten_lsp', 'vehicle', 'veh_lsp_213', 'telematics', 'TLM-F0E4') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_fa896a3caf2d', 'ten_lsp', 'vehicle', 'veh_lsp_213', 'trip_mgmt', 'TM-P213') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3ac209fd075a', 'ten_lsp', 'vehicle', 'veh_lsp_214', 'asset_mgmt', 'FA-30758') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_7a0c22a50af8', 'ten_lsp', 'vehicle', 'veh_lsp_214', 'safety', 'VS-V214L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_2818a56ed89d', 'ten_lsp', 'vehicle', 'veh_lsp_214', 'telematics', 'TLM-A343') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_2e1f9f15f11d', 'ten_lsp', 'vehicle', 'veh_lsp_214', 'trip_mgmt', 'TM-P214') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_41a901d48e8e', 'ten_lsp', 'vehicle', 'veh_lsp_215', 'asset_mgmt', 'FA-30855') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_9cc9291c4a48', 'ten_lsp', 'vehicle', 'veh_lsp_215', 'safety', 'VS-V215L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3e67f3e295be', 'ten_lsp', 'vehicle', 'veh_lsp_215', 'telematics', 'TLM-C16D') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_fa01e3fe2aec', 'ten_lsp', 'vehicle', 'veh_lsp_215', 'trip_mgmt', 'TM-P215') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_1ad2ca5f633b', 'ten_lsp', 'vehicle', 'veh_lsp_216', 'asset_mgmt', 'FA-30952') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f50515fe1b10', 'ten_lsp', 'vehicle', 'veh_lsp_216', 'safety', 'VS-V216L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d34a242d1ba6', 'ten_lsp', 'vehicle', 'veh_lsp_216', 'telematics', 'TLM-8BF1') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_510b41a9212c', 'ten_lsp', 'vehicle', 'veh_lsp_216', 'trip_mgmt', 'TM-P216') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_fbcfc9402fb3', 'ten_lsp', 'vehicle', 'veh_lsp_217', 'asset_mgmt', 'FA-31049') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_7c3b2fbadfda', 'ten_lsp', 'vehicle', 'veh_lsp_217', 'safety', 'VS-V217L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f5c39b5ae68d', 'ten_lsp', 'vehicle', 'veh_lsp_217', 'telematics', 'TLM-BC92') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_c5dec79bec17', 'ten_lsp', 'vehicle', 'veh_lsp_217', 'trip_mgmt', 'TM-P217') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e2d3fbd437f3', 'ten_lsp', 'vehicle', 'veh_lsp_218', 'asset_mgmt', 'FA-31146') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_ccf3b7128162', 'ten_lsp', 'vehicle', 'veh_lsp_218', 'safety', 'VS-V218L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_74fb4e237978', 'ten_lsp', 'vehicle', 'veh_lsp_218', 'telematics', 'TLM-35FD') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_96f3268a997c', 'ten_lsp', 'vehicle', 'veh_lsp_218', 'trip_mgmt', 'TM-P218') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_9c30a6c3f918', 'ten_lsp', 'vehicle', 'veh_lsp_219', 'asset_mgmt', 'FA-31243') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f33970fc37bf', 'ten_lsp', 'vehicle', 'veh_lsp_219', 'safety', 'VS-V219L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_ab438e937a39', 'ten_lsp', 'vehicle', 'veh_lsp_219', 'telematics', 'TLM-9DF8') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_a5cb1684e213', 'ten_lsp', 'vehicle', 'veh_lsp_219', 'trip_mgmt', 'TM-P219') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_01ac63d828e2', 'ten_lsp', 'vehicle', 'veh_lsp_220', 'asset_mgmt', 'FA-31340') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_c4ea6c5d6b3d', 'ten_lsp', 'vehicle', 'veh_lsp_220', 'safety', 'VS-V220L') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3926323f0e7e', 'ten_lsp', 'vehicle', 'veh_lsp_220', 'telematics', 'TLM-93D0') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_22990c5db7c1', 'ten_lsp', 'vehicle', 'veh_lsp_220', 'trip_mgmt', 'TM-P220') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_58dbe6e60614', 'ten_mvt', 'vehicle', 'veh_mvt_101', 'asset_mgmt', 'FA-19797') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_1c90f1c05863', 'ten_mvt', 'vehicle', 'veh_mvt_101', 'safety', 'VS-V101M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3141f20005c8', 'ten_mvt', 'vehicle', 'veh_mvt_101', 'telematics', 'TLM-CC89') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d6295cfd2834', 'ten_mvt', 'vehicle', 'veh_mvt_101', 'trip_mgmt', 'TM-V101') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_ad89fecddd5e', 'ten_mvt', 'vehicle', 'veh_mvt_102', 'asset_mgmt', 'FA-19894') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f2f6cecd3aea', 'ten_mvt', 'vehicle', 'veh_mvt_102', 'safety', 'VS-V102M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_4c54c5351e4f', 'ten_mvt', 'vehicle', 'veh_mvt_102', 'telematics', 'TLM-16CB') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e2c435c5fa63', 'ten_mvt', 'vehicle', 'veh_mvt_102', 'trip_mgmt', 'TM-V102') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_5879e7c1ed7a', 'ten_mvt', 'vehicle', 'veh_mvt_103', 'asset_mgmt', 'FA-19991') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3764b083c084', 'ten_mvt', 'vehicle', 'veh_mvt_103', 'safety', 'VS-V103M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_0cf4513fe07f', 'ten_mvt', 'vehicle', 'veh_mvt_103', 'telematics', 'TLM-C2B9') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_782cebb0319f', 'ten_mvt', 'vehicle', 'veh_mvt_103', 'trip_mgmt', 'TM-V103') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_0502b852b604', 'ten_mvt', 'vehicle', 'veh_mvt_104', 'asset_mgmt', 'FA-20088') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_5e86aa0fa39f', 'ten_mvt', 'vehicle', 'veh_mvt_104', 'safety', 'VS-V104M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3b51f940298f', 'ten_mvt', 'vehicle', 'veh_mvt_104', 'telematics', 'TLM-680D') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_69254d6652c7', 'ten_mvt', 'vehicle', 'veh_mvt_104', 'trip_mgmt', 'TM-V104') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e88e50a32f49', 'ten_mvt', 'vehicle', 'veh_mvt_105', 'asset_mgmt', 'FA-20185') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_ced5baedce2a', 'ten_mvt', 'vehicle', 'veh_mvt_105', 'safety', 'VS-V105M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e8ee502d538e', 'ten_mvt', 'vehicle', 'veh_mvt_105', 'telematics', 'TLM-F2AC') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_c01214aedf8f', 'ten_mvt', 'vehicle', 'veh_mvt_105', 'trip_mgmt', 'TM-V105') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_9d60a024d6a0', 'ten_mvt', 'vehicle', 'veh_mvt_106', 'asset_mgmt', 'FA-20282') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_65460f37f827', 'ten_mvt', 'vehicle', 'veh_mvt_106', 'safety', 'VS-V106M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f942b21dddae', 'ten_mvt', 'vehicle', 'veh_mvt_106', 'telematics', 'TLM-EAF6') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_1ecc5329c777', 'ten_mvt', 'vehicle', 'veh_mvt_106', 'trip_mgmt', 'TM-V106') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d77528ae6e44', 'ten_mvt', 'vehicle', 'veh_mvt_107', 'asset_mgmt', 'FA-20379') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_69b01844b7c3', 'ten_mvt', 'vehicle', 'veh_mvt_107', 'safety', 'VS-V107M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3a164c82479d', 'ten_mvt', 'vehicle', 'veh_mvt_107', 'telematics', 'TLM-C3AA') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_7532c6783fcf', 'ten_mvt', 'vehicle', 'veh_mvt_107', 'trip_mgmt', 'TM-V107') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d3f57b4e5ce0', 'ten_mvt', 'vehicle', 'veh_mvt_108', 'asset_mgmt', 'FA-20476') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d20d4e3ee24d', 'ten_mvt', 'vehicle', 'veh_mvt_108', 'safety', 'VS-V108M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_baf59c748ff6', 'ten_mvt', 'vehicle', 'veh_mvt_108', 'telematics', 'TLM-B3D7') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_a2c6451a20dc', 'ten_mvt', 'vehicle', 'veh_mvt_108', 'trip_mgmt', 'TM-V108') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_c42a28152e08', 'ten_mvt', 'vehicle', 'veh_mvt_109', 'asset_mgmt', 'FA-20573') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_433a30c7f290', 'ten_mvt', 'vehicle', 'veh_mvt_109', 'safety', 'VS-V109M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d6ac740c285a', 'ten_mvt', 'vehicle', 'veh_mvt_109', 'telematics', 'TLM-C7C9') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_4d1d48a7e5f4', 'ten_mvt', 'vehicle', 'veh_mvt_109', 'trip_mgmt', 'TM-V109') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_7a50363e79f4', 'ten_mvt', 'vehicle', 'veh_mvt_110', 'asset_mgmt', 'FA-20670') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_03a29a90b752', 'ten_mvt', 'vehicle', 'veh_mvt_110', 'safety', 'VS-V110M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e4b11fd7bb0e', 'ten_mvt', 'vehicle', 'veh_mvt_110', 'telematics', 'TLM-99FA') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d8d5e2353139', 'ten_mvt', 'vehicle', 'veh_mvt_110', 'trip_mgmt', 'TM-V110') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_d31077682b60', 'ten_mvt', 'vehicle', 'veh_mvt_111', 'asset_mgmt', 'FA-20767') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_050baf730363', 'ten_mvt', 'vehicle', 'veh_mvt_111', 'safety', 'VS-V111M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_b6b0ceba03b3', 'ten_mvt', 'vehicle', 'veh_mvt_111', 'telematics', 'TLM-8E57') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_559f199b58cd', 'ten_mvt', 'vehicle', 'veh_mvt_111', 'trip_mgmt', 'TM-V111') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_5de41a3aac45', 'ten_mvt', 'vehicle', 'veh_mvt_112', 'asset_mgmt', 'FA-20864') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_adeb2405f693', 'ten_mvt', 'vehicle', 'veh_mvt_112', 'safety', 'VS-V112M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_13174dff6de2', 'ten_mvt', 'vehicle', 'veh_mvt_112', 'telematics', 'TLM-71B1') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_6a8277d3e3db', 'ten_mvt', 'vehicle', 'veh_mvt_112', 'trip_mgmt', 'TM-V112') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_c945f2e9750a', 'ten_mvt', 'vehicle', 'veh_mvt_113', 'asset_mgmt', 'FA-20961') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e02ab62e2939', 'ten_mvt', 'vehicle', 'veh_mvt_113', 'safety', 'VS-V113M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_b5bd8c2f2d62', 'ten_mvt', 'vehicle', 'veh_mvt_113', 'telematics', 'TLM-D039') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3a1901880f68', 'ten_mvt', 'vehicle', 'veh_mvt_113', 'trip_mgmt', 'TM-V113') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f52472ee7352', 'ten_mvt', 'vehicle', 'veh_mvt_114', 'asset_mgmt', 'FA-21058') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_33eebded3dc8', 'ten_mvt', 'vehicle', 'veh_mvt_114', 'safety', 'VS-V114M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_aff763b108f8', 'ten_mvt', 'vehicle', 'veh_mvt_114', 'telematics', 'TLM-536D') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_0739f8c9e960', 'ten_mvt', 'vehicle', 'veh_mvt_114', 'trip_mgmt', 'TM-V114') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_e08a787d9189', 'ten_mvt', 'vehicle', 'veh_mvt_115', 'asset_mgmt', 'FA-21155') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_309b783bc9ed', 'ten_mvt', 'vehicle', 'veh_mvt_115', 'safety', 'VS-V115M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_28f6eb025be6', 'ten_mvt', 'vehicle', 'veh_mvt_115', 'telematics', 'TLM-6FB8') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_78be48557e45', 'ten_mvt', 'vehicle', 'veh_mvt_115', 'trip_mgmt', 'TM-V115') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f63ff8dd177e', 'ten_mvt', 'vehicle', 'veh_mvt_116', 'asset_mgmt', 'FA-21252') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_01becdd41f7f', 'ten_mvt', 'vehicle', 'veh_mvt_116', 'safety', 'VS-V116M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_233c826359a8', 'ten_mvt', 'vehicle', 'veh_mvt_116', 'telematics', 'TLM-E4E8') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_70ca1bd826f3', 'ten_mvt', 'vehicle', 'veh_mvt_116', 'trip_mgmt', 'TM-V116') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_52f75360ba2b', 'ten_mvt', 'vehicle', 'veh_mvt_117', 'asset_mgmt', 'FA-21349') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_00e51c54a5f5', 'ten_mvt', 'vehicle', 'veh_mvt_117', 'safety', 'VS-V117M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_230f14141600', 'ten_mvt', 'vehicle', 'veh_mvt_117', 'telematics', 'TLM-3031') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_6673857d92de', 'ten_mvt', 'vehicle', 'veh_mvt_117', 'trip_mgmt', 'TM-V117') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_2466919f0279', 'ten_mvt', 'vehicle', 'veh_mvt_118', 'asset_mgmt', 'FA-21446') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_ba082f3aed86', 'ten_mvt', 'vehicle', 'veh_mvt_118', 'safety', 'VS-V118M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_5bb81fe9800f', 'ten_mvt', 'vehicle', 'veh_mvt_118', 'telematics', 'TLM-9A0F') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_84f2c69d5c4b', 'ten_mvt', 'vehicle', 'veh_mvt_118', 'trip_mgmt', 'TM-V118') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_ee23ee77619e', 'ten_mvt', 'vehicle', 'veh_mvt_119', 'asset_mgmt', 'FA-21543') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_7eafccb8b4c6', 'ten_mvt', 'vehicle', 'veh_mvt_119', 'safety', 'VS-V119M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_b0c8e1547561', 'ten_mvt', 'vehicle', 'veh_mvt_119', 'telematics', 'TLM-4985') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3c661ebfb1b8', 'ten_mvt', 'vehicle', 'veh_mvt_119', 'trip_mgmt', 'TM-V119') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_1749ae9d1d85', 'ten_mvt', 'vehicle', 'veh_mvt_120', 'asset_mgmt', 'FA-21640') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_69abce415085', 'ten_mvt', 'vehicle', 'veh_mvt_120', 'safety', 'VS-V120M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_41316c58218d', 'ten_mvt', 'vehicle', 'veh_mvt_120', 'telematics', 'TLM-1F12') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_8aec4d17e1c7', 'ten_mvt', 'vehicle', 'veh_mvt_120', 'trip_mgmt', 'TM-V120') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_a7608896ee8f', 'ten_mvt', 'vehicle', 'veh_mvt_121', 'asset_mgmt', 'FA-21737') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_f06d3defb80d', 'ten_mvt', 'vehicle', 'veh_mvt_121', 'safety', 'VS-V121M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_64f4f6f513e8', 'ten_mvt', 'vehicle', 'veh_mvt_121', 'telematics', 'TLM-9A0B') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_38df93eae278', 'ten_mvt', 'vehicle', 'veh_mvt_121', 'trip_mgmt', 'TM-V121') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_ebefe08835c7', 'ten_mvt', 'vehicle', 'veh_mvt_122', 'asset_mgmt', 'FA-21834') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_2da87889f483', 'ten_mvt', 'vehicle', 'veh_mvt_122', 'safety', 'VS-V122M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_5afe5943c04c', 'ten_mvt', 'vehicle', 'veh_mvt_122', 'telematics', 'TLM-7E59') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_4670ef09f016', 'ten_mvt', 'vehicle', 'veh_mvt_122', 'trip_mgmt', 'TM-V122') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_4f6072c7346e', 'ten_mvt', 'vehicle', 'veh_mvt_123', 'asset_mgmt', 'FA-21931') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_6ddd54a4bae6', 'ten_mvt', 'vehicle', 'veh_mvt_123', 'safety', 'VS-V123M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3038ac627fa2', 'ten_mvt', 'vehicle', 'veh_mvt_123', 'telematics', 'TLM-2BF9') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_56695a0aabfe', 'ten_mvt', 'vehicle', 'veh_mvt_123', 'trip_mgmt', 'TM-V123') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_4019de6d65fb', 'ten_mvt', 'vehicle', 'veh_mvt_124', 'asset_mgmt', 'FA-22028') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_74c68e74445c', 'ten_mvt', 'vehicle', 'veh_mvt_124', 'safety', 'VS-V124M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_b16e14dc3d9b', 'ten_mvt', 'vehicle', 'veh_mvt_124', 'telematics', 'TLM-FC5B') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_de49f9716dd4', 'ten_mvt', 'vehicle', 'veh_mvt_124', 'trip_mgmt', 'TM-V124') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_a8104b6c0bc4', 'ten_mvt', 'vehicle', 'veh_mvt_125', 'asset_mgmt', 'FA-22125') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_92fa14c0d2bf', 'ten_mvt', 'vehicle', 'veh_mvt_125', 'safety', 'VS-V125M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_3a8657a4ca2b', 'ten_mvt', 'vehicle', 'veh_mvt_125', 'telematics', 'TLM-E944') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_85d5efbfdf0d', 'ten_mvt', 'vehicle', 'veh_mvt_125', 'trip_mgmt', 'TM-V125') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_97a53e727294', 'ten_mvt', 'vehicle', 'veh_mvt_126', 'asset_mgmt', 'FA-22222') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_bed7d8983867', 'ten_mvt', 'vehicle', 'veh_mvt_126', 'safety', 'VS-V126M') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_9ebda9ba8d2c', 'ten_mvt', 'vehicle', 'veh_mvt_126', 'telematics', 'TLM-108D') ON CONFLICT DO NOTHING;
INSERT INTO public.identity_crosswalk (id, tenant_id, entity_type, canonical_id, system, external_id) VALUES ('xw_a55137f838dc', 'ten_mvt', 'vehicle', 'veh_mvt_126', 'trip_mgmt', 'TM-V126') ON CONFLICT DO NOTHING;
COMMIT;

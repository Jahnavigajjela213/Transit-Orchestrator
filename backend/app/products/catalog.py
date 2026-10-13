"""Reference data shared by the synthetic products and the assessment logic."""

VEHICLE_TYPES = {
    # type: (capacity, wheelchair positions, license class required, needs air-brake cert)
    "40ft Bus": (40, 2, "B", True),
    "35ft Bus": (32, 2, "B", True),
    "Cutaway": (16, 2, "C", False),
    "Paratransit Van": (8, 3, "C", False),
}

# Higher class can drive lower-class vehicles.
LICENSE_RANK = {"A": 3, "B": 2, "C": 1}

FAULT_CODES = [
    # code, description, system, severity, est repair hours, affects accessibility
    ("P0217", "Engine coolant over-temperature", "Engine", "critical", 10, False),
    ("BRK-02", "Brake pad wear below minimum", "Brakes", "critical", 6, False),
    ("P0520", "Oil pressure sensor circuit", "Engine", "high", 5, False),
    ("C1201", "ABS control system malfunction", "Brakes", "high", 8, False),
    ("P0300", "Random or multiple cylinder misfire", "Engine", "high", 12, False),
    ("LIFT-01", "Wheelchair lift hydraulic fault", "Accessibility", "high", 6, True),
    ("B1342", "ECU internal fault", "Electrical", "medium", 6, False),
    ("U0100", "Lost communication with ECM", "Electrical", "medium", 4, False),
    ("HVAC-05", "HVAC compressor clutch circuit", "Comfort", "medium", 5, False),
    ("P0420", "Catalyst efficiency below threshold", "Emissions", "low", 4, False),
    ("TPMS-1", "Tire pressure sensor fault", "Chassis", "low", 2, False),
]

PM_FAULT_CODE = "PM-DUE"

DEPOTS = ["North Yard", "South Yard"]


def license_ok(license_class: str, vehicle_type: str) -> bool:
    required = VEHICLE_TYPES[vehicle_type][2]
    return LICENSE_RANK.get(license_class, 0) >= LICENSE_RANK[required]


def driver_qualified(license_class: str, certifications: list[str], vehicle_type: str, needs_wheelchair: bool) -> tuple[bool, str]:
    if not license_ok(license_class, vehicle_type):
        return False, f"class {license_class} license cannot drive a {vehicle_type}"
    if VEHICLE_TYPES[vehicle_type][3] and "air_brakes" not in certifications:
        return False, "missing air brake endorsement"
    if needs_wheelchair and "wheelchair_securement" not in certifications:
        return False, "missing wheelchair securement certification"
    return True, "qualified"

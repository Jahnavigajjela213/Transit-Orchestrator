"""Synthetic Bytecurve (workforce): employees, licences, certifications."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProductAPIError
from app.models import Employee

SYSTEM = "workforce"


async def list_employees(s: AsyncSession, tenant_id: str, active_only: bool = False) -> list[Employee]:
    q = select(Employee).where(Employee.tenant_id == tenant_id)
    if active_only:
        q = q.where(Employee.status == "active")
    return list((await s.execute(q.order_by(Employee.full_name))).scalars())


async def get_employee(s: AsyncSession, tenant_id: str, employee_number: str) -> Employee:
    e = await s.get(Employee, employee_number)
    if not e or e.tenant_id != tenant_id:
        raise ProductAPIError(SYSTEM, "get_employee", f"Employee {employee_number} not found")
    return e

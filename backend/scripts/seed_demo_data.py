"""
Seed demo data for RoleTraceabilityTab testing.
Run from backend directory: python scripts/seed_demo_data.py
"""
import sys
from datetime import datetime, timedelta
from pytz import timezone

# Setup path
sys.path.insert(0, ".")

from app.routes.projects import PROJECTS_DB, save_projects_state
from app.routes.upload import FILES_DB, save_files_state
from app.models.project import ProjectNode
from app.db.user_store import USERS_DB, save_users_state, _seed_defaults_if_needed

def seed_demo_data():
    """Create realistic demo project structure and processes."""
    
    # 1. Load or create default users
    _seed_defaults_if_needed()
    
    # 2. Add extra demo users with different roles
    demo_users = [
        {"id": "user-demo-1", "username": "juan_responsable", "role": "responsable", "roles": ["responsable"]},
        {"id": "user-demo-2", "username": "maria_responsable", "role": "responsable", "roles": ["responsable"]},
        {"id": "user-demo-3", "username": "carlos_conf", "role": "configurador", "roles": ["configurador"]},
    ]
    for u in demo_users:
        if u["id"] not in USERS_DB:
            USERS_DB[u["id"]] = u
    
    save_users_state()
    
    # 3. Create demo project hierarchy: Empresa > Departamento > Proyecto
    # Build hierarchy using ProjectNode
    empresa = ProjectNode(
        id="empresa-1", name="ACME Corp", level=1, parent_id=None, created_at=datetime.now().isoformat()
    )
    
    dept_ventas = ProjectNode(
        id="dept-1", name="Departamento Ventas", level=2, parent_id="empresa-1", created_at=datetime.now().isoformat()
    )
    dept_ops = ProjectNode(
        id="dept-2", name="Departamento Operaciones", level=2, parent_id="empresa-1", created_at=datetime.now().isoformat()
    )
    
    proj_leads = ProjectNode(
        id="proj-1", name="Proyecto Leads", level=3, parent_id="dept-1", created_at=datetime.now().isoformat()
    )
    proj_funnels = ProjectNode(
        id="proj-2", name="Proyecto Funnels", level=3, parent_id="dept-1", created_at=datetime.now().isoformat()
    )
    proj_inventory = ProjectNode(
        id="proj-3", name="Proyecto Inventario", level=3, parent_id="dept-2", created_at=datetime.now().isoformat()
    )
    proj_billing = ProjectNode(
        id="proj-4", name="Proyecto Facturación", level=3, parent_id="dept-2", created_at=datetime.now().isoformat()
    )
    
    empresa.children = [dept_ventas, dept_ops]
    dept_ventas.children = [proj_leads, proj_funnels]
    dept_ops.children = [proj_inventory, proj_billing]
    
    # Store in PROJECTS_DB
    PROJECTS_DB.clear()
    PROJECTS_DB["empresa-1"] = empresa
    
    save_projects_state()
    
    # 4. Create processes (FILES_DB records) with commitment schedules
    _SCL = timezone("America/Santiago")
    now = datetime.now(_SCL)
    
    processes = [
        {
            "id": "proc-leads-daily",
            "process_name": "Extracción diaria de Leads",
            "project_id": "proj-1",
            "latest_input_name": "leads.csv",
            "frequency": "daily",
            "commitment_schedule_set_at": (now - timedelta(days=30)).isoformat(),
            "commitment_schedule": [
                {"day_of_week": i, "hour": 6, "minute": 0} for i in range(7)
            ],
            "executions": [
                {"timestamp": (now - timedelta(days=d, hours=1)).isoformat(), "uploaded_by": "SYSTEM"}
                for d in range(7)
            ]
        },
        {
            "id": "proc-leads-weekly",
            "process_name": "Reporte semanal de Leads",
            "project_id": "proj-1",
            "latest_input_name": "leads-report.xlsx",
            "frequency": "weekly",
            "commitment_schedule_set_at": (now - timedelta(days=15)).isoformat(),
            "commitment_schedule": [
                {"day_of_week": 1, "hour": 9, "minute": 0}
            ],
            "executions": [
                {"timestamp": (now - timedelta(days=d*7, hours=2)).isoformat(), "uploaded_by": "juan_responsable"}
                for d in range(4)
            ]
        },
        {
            "id": "proc-funnels-monthly",
            "process_name": "Análisis mensual de Funnels",
            "project_id": "proj-2",
            "latest_input_name": "funnels-analysis.xlsx",
            "frequency": "monthly",
            "commitment_schedule_set_at": (now - timedelta(days=60)).isoformat(),
            "commitment_schedule": [
                {"day_of_month": 1, "hour": 8, "minute": 0}
            ],
            "executions": [
                {"timestamp": (now - timedelta(days=30)).isoformat(), "uploaded_by": "maria_responsable"},
                {"timestamp": (now - timedelta(days=60)).isoformat(), "uploaded_by": "maria_responsable"},
            ]
        },
        {
            "id": "proc-inventory-real-time",
            "process_name": "Actualización de Inventario (Real-time)",
            "project_id": "proj-3",
            "latest_input_name": "inventory.csv",
            "frequency": "hourly",
            "commitment_schedule_set_at": (now - timedelta(days=90)).isoformat(),
            "commitment_schedule": [
                {"hour": h, "minute": 0} for h in range(24)
            ],
            "executions": [
                {"timestamp": (now - timedelta(hours=h)).isoformat(), "uploaded_by": "SYSTEM"}
                for h in range(24)
            ]
        },
        {
            "id": "proc-billing-weekly",
            "process_name": "Generación de facturas semanales",
            "project_id": "proj-4",
            "latest_input_name": "invoices.csv",
            "frequency": "weekly",
            "commitment_schedule_set_at": (now - timedelta(days=45)).isoformat(),
            "commitment_schedule": [
                {"day_of_week": 5, "hour": 17, "minute": 0}
            ],
            "executions": [
                {"timestamp": (now - timedelta(days=d*7, hours=3)).isoformat(), "uploaded_by": "carlos_conf"}
                for d in range(2)
            ] # NOTE: 2 weeks old - should show as atrasado
        },
    ]
    
    FILES_DB.clear()
    for p in processes:
        FILES_DB[p["id"]] = p
    
    save_files_state()
    
    # 5. Assign roles to processes
    # juan_responsable assigned to leads processes
    USERS_DB["user-demo-1"]["assigned_project_ids"] = ["proc-leads-daily", "proc-leads-weekly"]
    
    # maria_responsable assigned to funnels and inventory
    USERS_DB["user-demo-2"]["assigned_project_ids"] = ["proc-funnels-monthly", "proc-inventory-real-time"]
    
    # carlos_conf (configurador) assigned to billing
    USERS_DB["user-demo-3"]["assigned_project_ids"] = ["proc-billing-weekly"]
    
    save_users_state()
    
    print("\n✅ Demo data seeded successfully!")
    print(f"   - Projects: {len(PROJECTS_DB)}")
    print(f"   - Processes: {len(FILES_DB)}")
    print(f"   - Users: {len(USERS_DB)}")
    print("\nNow visit: http://localhost:3000/admin > Trazabilidad Roles")
    print("Make sure backend is running: python -m app.main (from backend/)")

if __name__ == "__main__":
    seed_demo_data()

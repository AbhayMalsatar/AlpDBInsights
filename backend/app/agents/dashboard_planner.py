"""
Auto-Dashboard Planner — uses LLM to design a full multi-tab dashboard
from a database schema, then executes each SQL to get real data.
Minimum 6 charts per tab.
"""
import json
import logging
import re
from typing import Optional

from app.config import settings
from app.services.fine_tuning_service import resolve_openai_model

logger = logging.getLogger(__name__)

PLAN_PROMPT = """You are an expert business intelligence analyst.
Analyze the database schema below and create a comprehensive business dashboard.

DATABASE SCHEMA:
{schema}

DATABASE TYPE: {db_type}

Create a dashboard with:
- 3–4 tabs, each focused on a distinct business area (e.g. Sales, Products, Customers, Operations)
- MINIMUM 6 charts per tab — use every meaningful metric and angle you can find
- Mix chart types: bar, line, area, pie, table for variety
- SQL queries that ONLY use tables/columns present in the schema

STRICT SQL RULES:
1. SELECT only — never DROP, DELETE, UPDATE, INSERT, ALTER, CREATE
2. NEVER show raw ID columns — JOIN related tables for human-readable names
3. Always ORDER BY the metric DESC (or date ASC for time-series)
4. LIMIT 10–15 rows for bar/pie, 24 for monthly trends, 20 for tables
5. PostgreSQL: use DATE_TRUNC('month', col)::date for monthly grouping
6. SQL Server: use CONVERT(varchar(7), col, 120) for monthly grouping
7. Use descriptive aliases (AS total_revenue, AS month, AS product_name)
8. Keep SQL simple — no CTEs or complex window functions

Respond with ONLY valid JSON — no markdown, no explanation:
{{
  "dashboard_name": "...",
  "tabs": [
    {{
      "name": "Tab Name",
      "charts": [
        {{"title": "...", "type": "bar", "sql": "SELECT ..."}},
        {{"title": "...", "type": "line", "sql": "SELECT ..."}},
        {{"title": "...", "type": "pie", "sql": "SELECT ..."}},
        {{"title": "...", "type": "area", "sql": "SELECT ..."}},
        {{"title": "...", "type": "bar", "sql": "SELECT ..."}},
        {{"title": "...", "type": "table", "sql": "SELECT ..."}}
      ]
    }}
  ]
}}

Chart types: bar, line, area, pie, table
"""


def plan_dashboard_with_llm(schema_context: str, db_type: str = "postgresql", db_id: Optional[str] = None) -> Optional[dict]:
    """Ask LLM to return a JSON dashboard plan with ≥6 charts per tab."""
    try:
        from openai import OpenAI
        if not settings.openai_api_key:
            logger.warning("No OpenAI key — using rule-based plan")
            return None

        client = OpenAI(api_key=settings.openai_api_key)
        model = resolve_openai_model(db_id, settings.openai_model)
        prompt = PLAN_PROMPT.format(schema=schema_context[:8000], db_type=db_type)

        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=4000,
        )
        raw = resp.choices[0].message.content or ""
        logger.info(f"[planner] LLM raw length: {len(raw)}")

        raw = re.sub(r"^```[a-z]*\n?", "", raw.strip())
        raw = re.sub(r"\n?```$", "", raw.strip())

        plan = json.loads(raw)
        logger.info(f"[planner] Plan: {len(plan.get('tabs',[]))} tabs, "
                    f"charts/tab: {[len(t.get('charts',[])) for t in plan.get('tabs',[])]}")
        return plan
    except json.JSONDecodeError as e:
        logger.error(f"[planner] JSON parse error: {e}")
        return None
    except Exception as e:
        logger.error(f"[planner] LLM call failed: {e}")
        return None


# ── Northwind / typical e-commerce chart library ──────────────────────────

def _northwind_charts(tl: list) -> dict[str, list]:
    """Pre-built chart recipes keyed by business area for common schemas."""
    charts: dict[str, list] = {}

    # ── Sales / Orders ─────────────────────────────────────────────────────
    sales = []
    if 'orders' in tl:
        sales += [
            {"title": "Monthly Orders Trend",       "type": "line",
             "sql": "SELECT DATE_TRUNC('month', order_date)::date AS month, COUNT(*) AS orders FROM orders GROUP BY 1 ORDER BY 1 LIMIT 24"},
            {"title": "Monthly Revenue Trend",       "type": "area",
             "sql": "SELECT DATE_TRUNC('month', o.order_date)::date AS month, SUM(od.unit_price * od.quantity * (1 - od.discount)) AS revenue FROM orders o JOIN order_details od ON o.order_id = od.order_id GROUP BY 1 ORDER BY 1 LIMIT 24"
             if 'order_details' in tl else
             "SELECT DATE_TRUNC('month', order_date)::date AS month, COUNT(*) AS orders FROM orders GROUP BY 1 ORDER BY 1 LIMIT 24"},
            {"title": "Orders by Ship Country",      "type": "bar",
             "sql": "SELECT ship_country, COUNT(*) AS orders FROM orders GROUP BY ship_country ORDER BY orders DESC LIMIT 15"},
            {"title": "Order Freight Cost by Country","type": "bar",
             "sql": "SELECT ship_country, ROUND(SUM(freight)::numeric, 2) AS total_freight FROM orders GROUP BY ship_country ORDER BY total_freight DESC LIMIT 10"},
            {"title": "Orders by Ship Via (Carrier)", "type": "pie",
             "sql": "SELECT ship_via::text AS carrier, COUNT(*) AS orders FROM orders GROUP BY ship_via ORDER BY orders DESC"},
            {"title": "Orders Placed per Quarter",   "type": "bar",
             "sql": "SELECT EXTRACT(QUARTER FROM order_date)::text AS quarter, COUNT(*) AS orders FROM orders GROUP BY quarter ORDER BY quarter"},
        ]
        if 'order_details' in tl and 'products' in tl:
            sales += [
                {"title": "Top 10 Products by Revenue", "type": "bar",
                 "sql": "SELECT p.product_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue FROM order_details od JOIN products p ON od.product_id = p.product_id GROUP BY p.product_name ORDER BY revenue DESC LIMIT 10"},
                {"title": "Top 10 Products by Quantity Sold", "type": "bar",
                 "sql": "SELECT p.product_name, SUM(od.quantity) AS qty_sold FROM order_details od JOIN products p ON od.product_id = p.product_id GROUP BY p.product_name ORDER BY qty_sold DESC LIMIT 10"},
            ]
        if 'customers' in tl:
            sales += [
                {"title": "Top 10 Customers by Revenue", "type": "bar",
                 "sql": "SELECT c.company_name, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue FROM customers c JOIN orders o ON c.customer_id = o.customer_id JOIN order_details od ON o.order_id = od.order_id GROUP BY c.company_name ORDER BY revenue DESC LIMIT 10"
                 if 'order_details' in tl else
                 "SELECT c.company_name, COUNT(o.order_id) AS orders FROM customers c JOIN orders o ON c.customer_id = o.customer_id GROUP BY c.company_name ORDER BY orders DESC LIMIT 10"},
            ]
    if sales:
        charts["Sales & Orders"] = sales

    # ── Products ───────────────────────────────────────────────────────────
    products = []
    if 'products' in tl:
        products += [
            {"title": "Top 15 Products in Stock",      "type": "bar",
             "sql": "SELECT product_name, units_in_stock FROM products WHERE units_in_stock > 0 ORDER BY units_in_stock DESC LIMIT 15"},
            {"title": "Products Low on Stock (< 20)",  "type": "bar",
             "sql": "SELECT product_name, units_in_stock FROM products WHERE units_in_stock < 20 AND discontinued = 0 ORDER BY units_in_stock ASC LIMIT 15"},
            {"title": "Unit Price Distribution",       "type": "bar",
             "sql": "SELECT product_name, ROUND(unit_price::numeric, 2) AS unit_price FROM products ORDER BY unit_price DESC LIMIT 15"},
            {"title": "Units on Order by Product",     "type": "bar",
             "sql": "SELECT product_name, units_on_order FROM products WHERE units_on_order > 0 ORDER BY units_on_order DESC LIMIT 15"},
        ]
        if 'categories' in tl:
            products += [
                {"title": "Stock by Category",         "type": "bar",
                 "sql": "SELECT c.category_name, SUM(p.units_in_stock) AS total_stock FROM products p JOIN categories c ON p.category_id = c.category_id GROUP BY c.category_name ORDER BY total_stock DESC"},
                {"title": "Product Count by Category", "type": "pie",
                 "sql": "SELECT c.category_name, COUNT(*) AS products FROM products p JOIN categories c ON p.category_id = c.category_id GROUP BY c.category_name ORDER BY products DESC"},
                {"title": "Avg Unit Price by Category","type": "bar",
                 "sql": "SELECT c.category_name, ROUND(AVG(p.unit_price)::numeric, 2) AS avg_price FROM products p JOIN categories c ON p.category_id = c.category_id GROUP BY c.category_name ORDER BY avg_price DESC"},
            ]
        if 'suppliers' in tl:
            products += [
                {"title": "Products by Supplier",      "type": "bar",
                 "sql": "SELECT s.company_name AS supplier, COUNT(*) AS products FROM products p JOIN suppliers s ON p.supplier_id = s.supplier_id GROUP BY s.company_name ORDER BY products DESC LIMIT 15"},
            ]
    if products:
        charts["Products & Inventory"] = products

    # ── Customers ──────────────────────────────────────────────────────────
    customers = []
    if 'customers' in tl:
        customers += [
            {"title": "Customers by Country",          "type": "bar",
             "sql": "SELECT country, COUNT(*) AS customers FROM customers GROUP BY country ORDER BY customers DESC LIMIT 20"},
            {"title": "Customers by City (Top 15)",    "type": "bar",
             "sql": "SELECT city, COUNT(*) AS customers FROM customers GROUP BY city ORDER BY customers DESC LIMIT 15"},
            {"title": "Customers Distribution (Country)", "type": "pie",
             "sql": "SELECT country, COUNT(*) AS customers FROM customers GROUP BY country ORDER BY customers DESC LIMIT 10"},
            {"title": "All Customers Overview",        "type": "table",
             "sql": "SELECT company_name, contact_name, city, country, phone FROM customers ORDER BY company_name LIMIT 20"},
        ]
        if 'orders' in tl:
            customers += [
                {"title": "Top 10 Customers by Order Count", "type": "bar",
                 "sql": "SELECT c.company_name, COUNT(o.order_id) AS total_orders FROM customers c JOIN orders o ON c.customer_id = o.customer_id GROUP BY c.company_name ORDER BY total_orders DESC LIMIT 10"},
                {"title": "Customer Orders by Country", "type": "bar",
                 "sql": "SELECT c.country, COUNT(o.order_id) AS orders FROM customers c JOIN orders o ON c.customer_id = o.customer_id GROUP BY c.country ORDER BY orders DESC LIMIT 15"},
            ]
    if customers:
        charts["Customers"] = customers

    # ── Employees ──────────────────────────────────────────────────────────
    employees = []
    if 'employees' in tl:
        employees += [
            {"title": "Employees List",                "type": "table",
             "sql": "SELECT first_name || ' ' || last_name AS name, title, city, country, hire_date FROM employees ORDER BY hire_date"},
            {"title": "Employees by Title",            "type": "bar",
             "sql": "SELECT title, COUNT(*) AS count FROM employees GROUP BY title ORDER BY count DESC"},
            {"title": "Employees by Country",          "type": "pie",
             "sql": "SELECT country, COUNT(*) AS employees FROM employees GROUP BY country ORDER BY employees DESC"},
        ]
        if 'orders' in tl:
            employees += [
                {"title": "Orders per Employee",       "type": "bar",
                 "sql": "SELECT e.first_name || ' ' || e.last_name AS employee, COUNT(o.order_id) AS orders_handled FROM employees e JOIN orders o ON e.employee_id = o.employee_id GROUP BY employee ORDER BY orders_handled DESC"},
                {"title": "Revenue per Employee",      "type": "bar",
                 "sql": "SELECT e.first_name || ' ' || e.last_name AS employee, ROUND(SUM(od.unit_price * od.quantity * (1 - od.discount))::numeric, 2) AS revenue FROM employees e JOIN orders o ON e.employee_id = o.employee_id JOIN order_details od ON o.order_id = od.order_id GROUP BY employee ORDER BY revenue DESC"
                 if 'order_details' in tl else
                 "SELECT e.first_name || ' ' || e.last_name AS employee, COUNT(o.order_id) AS orders FROM employees e JOIN orders o ON e.employee_id = o.employee_id GROUP BY employee ORDER BY orders DESC"},
                {"title": "Monthly Orders by Employee (Top 3)", "type": "line",
                 "sql": "SELECT DATE_TRUNC('month', o.order_date)::date AS month, e.first_name || ' ' || e.last_name AS employee, COUNT(*) AS orders FROM orders o JOIN employees e ON o.employee_id = e.employee_id GROUP BY 1, employee ORDER BY 1 LIMIT 36"},
            ]
    if employees:
        charts["Employees"] = employees

    # ── Suppliers ──────────────────────────────────────────────────────────
    suppliers = []
    if 'suppliers' in tl:
        suppliers += [
            {"title": "Suppliers by Country",          "type": "bar",
             "sql": "SELECT country, COUNT(*) AS suppliers FROM suppliers GROUP BY country ORDER BY suppliers DESC LIMIT 15"},
            {"title": "Suppliers by City",             "type": "bar",
             "sql": "SELECT city, COUNT(*) AS suppliers FROM suppliers WHERE city IS NOT NULL GROUP BY city ORDER BY suppliers DESC LIMIT 15"},
            {"title": "All Suppliers",                 "type": "table",
             "sql": "SELECT company_name, contact_name, city, country, phone FROM suppliers ORDER BY company_name LIMIT 20"},
        ]
        if 'products' in tl:
            suppliers += [
                {"title": "Products per Supplier",     "type": "bar",
                 "sql": "SELECT s.company_name AS supplier, COUNT(*) AS products FROM products p JOIN suppliers s ON p.supplier_id = s.supplier_id GROUP BY s.company_name ORDER BY products DESC LIMIT 15"},
                {"title": "Avg Product Price by Supplier", "type": "bar",
                 "sql": "SELECT s.company_name AS supplier, ROUND(AVG(p.unit_price)::numeric, 2) AS avg_price FROM products p JOIN suppliers s ON p.supplier_id = s.supplier_id GROUP BY s.company_name ORDER BY avg_price DESC LIMIT 15"},
            ]
    if suppliers:
        charts["Suppliers"] = suppliers

    return charts


def build_rule_based_plan(schema_context: str, db_type: str) -> dict:
    """
    Fallback: build a rich 6-chart plan from schema table names without LLM.
    """
    table_names = re.findall(r'Table:\s*(\w+)', schema_context)
    tl          = [t.lower() for t in table_names]

    if not table_names:
        return {
            "dashboard_name": "Dashboard",
            "tabs": [{"name": "Overview", "charts": [
                {"title": "Data Sample", "type": "table", "sql": "SELECT * FROM data LIMIT 20"},
            ]}],
        }

    chart_lib  = _northwind_charts(tl)
    tabs       = []

    for tab_name, charts in chart_lib.items():
        # Always include at least 6 charts — pad with table view if needed
        while len(charts) < 6 and table_names:
            t = table_names[0]
            charts.append({
                "title": f"{t.replace('_', ' ').title()} Sample Data",
                "type":  "table",
                "sql":   f"SELECT * FROM {t} LIMIT 20",
            })
        tabs.append({"name": tab_name, "charts": charts[:8]})  # max 8 per tab

    # Generic fallback if none matched
    if not tabs:
        generic_charts = []
        for t in table_names[:4]:
            generic_charts.append({
                "title": f"{t.replace('_', ' ').title()} Data",
                "type":  "table",
                "sql":   f"SELECT * FROM {t} LIMIT 20",
            })
        # Pad to 6
        while len(generic_charts) < 6:
            generic_charts.append({
                "title": f"Count from {table_names[0]}",
                "type":  "bar",
                "sql":   f"SELECT * FROM {table_names[0]} LIMIT 20",
            })
        tabs = [{"name": "Overview", "charts": generic_charts}]

    return {
        "dashboard_name": "Business Dashboard",
        "tabs": tabs[:4],
    }


async def execute_dashboard_plan(plan: dict, db_config: dict) -> dict:
    """
    For each chart in the plan, execute the SQL and attach real data.
    Returns the enriched plan.
    """
    from app.services.query_service import execute_query
    from app.models.schemas import DatabaseType
    from app.agents.chart_agent import select_keys

    db_type      = DatabaseType(db_config["type"])
    result_tabs  = []

    for tab in plan.get("tabs", []):
        result_charts = []
        for chart in tab.get("charts", []):
            sql        = chart.get("sql", "")
            rows, cols = [], []
            error      = None
            try:
                res  = execute_query(
                    db_type  =db_type,
                    host     =db_config["host"],
                    port     =db_config["port"],
                    username =db_config["username"],
                    password =db_config["password"],
                    database =db_config["database"],
                    sql      =sql,
                )
                rows = res.rows
                cols = res.columns
                logger.info(f"[exec] '{chart['title']}' → {len(rows)} rows")
            except Exception as e:
                error = str(e)
                logger.error(f"[exec] '{chart.get('title')}' failed: {e}")

            if rows and cols:
                ct          = chart.get("type", "bar")
                x_key, yks  = select_keys(cols, ct)
                result_charts.append({
                    "title":   chart["title"],
                    "type":    ct,
                    "sql":     sql,
                    "data":    rows,
                    "columns": cols,
                    "x_key":   x_key,
                    "y_key":   yks[0] if yks else None,
                    "error":   None,
                })
            elif error:
                result_charts.append({
                    "title":   chart["title"],
                    "type":    chart.get("type", "bar"),
                    "sql":     sql,
                    "data":    [],
                    "columns": [],
                    "x_key":   None,
                    "y_key":   None,
                    "error":   error,
                })

        if result_charts:
            result_tabs.append({"name": tab["name"], "charts": result_charts})

    return {
        "dashboard_name": plan.get("dashboard_name", "Business Dashboard"),
        "tabs": result_tabs,
    }

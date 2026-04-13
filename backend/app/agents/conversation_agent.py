"""
Conversation agent — handles greetings, help, clarifications, and ambiguous queries.
Makes the AI feel like a real data analyst assistant.
"""
import re
import logging

logger = logging.getLogger(__name__)

# ── Greeting / social patterns ────────────────────────────────────────────────
GREETING_PATTERNS = [
    r'^(hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening|sup|what\'s up|yo)\b',
    r'^(greetings|namaste|salut)\b',
]
THANKS_PATTERNS = [
    r'\b(thank you|thanks|thx|thank u|ty|cheers|great|awesome|perfect|nice|good job|well done)\b',
]
HELP_PATTERNS = [
    r'\b(help|what can you do|how do you work|what are your capabilities|what can i ask|guide me)\b',
    r'^help\s*$',
]
UNCLEAR_SHORT = 3   # words or fewer with no data keyword → ask for clarification


# ── Check query type ──────────────────────────────────────────────────────────

def is_greeting(msg: str) -> bool:
    lower = msg.strip().lower()
    return any(re.search(p, lower) for p in GREETING_PATTERNS)


def is_thanks(msg: str) -> bool:
    lower = msg.lower()
    return any(re.search(p, lower) for p in THANKS_PATTERNS) and len(msg.split()) <= 6


def is_help_request(msg: str) -> bool:
    lower = msg.lower()
    return any(re.search(p, lower) for p in HELP_PATTERNS)


def is_ambiguous(msg: str, schema_context: str) -> bool:
    """Return True if the message is too vague to generate a reliable chart."""
    words = msg.strip().split()
    lower = msg.lower()

    # Very short messages with no data concept
    data_keywords = [
        'sales', 'order', 'product', 'customer', 'revenue', 'purchase',
        'stock', 'inventory', 'profit', 'category', 'employee', 'supplier',
        'quantity', 'amount', 'freight', 'discount', 'price', 'trend',
        'monthly', 'weekly', 'daily', 'top', 'bottom', 'compare',
    ]
    has_data_keyword = any(kw in lower for kw in data_keywords)

    # Also check if any schema table name appears in the message
    table_names = re.findall(r'Table:\s*(\w+)', schema_context)
    has_table_ref = any(t.lower() in lower for t in table_names)

    if len(words) <= UNCLEAR_SHORT and not has_data_keyword and not has_table_ref:
        return True

    # Single-word data queries with no context
    if len(words) == 1 and words[0].lower() in {'data', 'report', 'chart', 'graph', 'show', 'give'}:
        return True

    return False


# ── Response builders ─────────────────────────────────────────────────────────

def greeting_response(schema_context: str, db_name: str = "your database") -> dict:
    table_names = re.findall(r'Table:\s*(\w+)', schema_context)
    table_list  = ", ".join(f"**{t}**" for t in table_names[:6])
    extra       = f" (+{len(table_names)-6} more)" if len(table_names) > 6 else ""

    examples = _build_examples(table_names)

    return {
        "type":    "greeting",
        "message": (
            f"Hi! 👋 I'm your AI data assistant. I'm connected to {db_name} "
            f"which has {len(table_names)} tables: {table_list}{extra}.\n\n"
            f"Ask me anything in plain English and I'll build a chart from real data!"
        ),
        "suggestions": examples[:4],
    }


def thanks_response() -> dict:
    return {
        "type":    "thanks",
        "message": "You're welcome! 😊 Ask me anything else — I'm here to help.",
        "suggestions": [],
    }


def help_response(schema_context: str) -> dict:
    table_names = re.findall(r'Table:\s*(\w+)', schema_context)
    examples    = _build_examples(table_names)

    capabilities = [
        "📊 Create bar, line, pie, area, and table charts",
        "🔍 Query any table using plain English",
        "📅 Filter by date range, category, or any column",
        "🔢 Aggregate data — totals, averages, counts",
        "📈 Trend analysis over time",
        "🏆 Top/bottom N rankings",
    ]

    return {
        "type":    "help",
        "message": (
            "Here's what I can do:\n\n"
            + "\n".join(capabilities)
            + f"\n\nYour database has these tables: **{', '.join(table_names)}**"
        ),
        "suggestions": examples[:6],
    }


def clarification_response(msg: str, schema_context: str) -> dict:
    """Build a clarifying question with concrete suggestions based on the schema."""
    table_names = re.findall(r'Table:\s*(\w+)', schema_context)
    lower = msg.lower()

    # Try to match the user's intent to a table
    matched_table = None
    for table in table_names:
        if table.lower() in lower or _fuzzy_match(lower, table):
            matched_table = table
            break

    if matched_table:
        suggestions = _suggestions_for_table(matched_table, table_names)
        question = (
            f"I found the **{matched_table}** table. What would you like to see? "
            f"Here are some ideas:"
        )
    else:
        suggestions = _build_examples(table_names)[:5]
        question = (
            f"I want to help, but I'm not sure what to show. "
            f"Could you be more specific? Here are some things I can do:"
        )

    return {
        "type":        "clarification",
        "message":     question,
        "suggestions": suggestions,
    }


def llm_clarification(msg: str, schema_context: str) -> str:
    """Use OpenAI to generate a smart clarifying question."""
    try:
        from openai import OpenAI
        from app.config import settings
        if not settings.openai_api_key:
            return ""
        client = OpenAI(api_key=settings.openai_api_key)
        prompt = f"""You are a friendly data analyst chatbot. 
The user sent: "{msg}"
The database has these tables (schema below). The request is unclear or incomplete.

Schema:
{schema_context[:2000]}

Write ONE short, friendly clarifying question (max 2 sentences) asking what they want to see.
Then provide 3-4 concrete example questions they could ask, each on its own line starting with "- ".
Keep it conversational and helpful. Do not use markdown headers."""

        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=200,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.warning(f"LLM clarification failed: {e}")
        return ""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_examples(table_names: list[str]) -> list[str]:
    """Build example queries based on what tables exist."""
    examples = []
    tl = [t.lower() for t in table_names]

    if 'orders' in tl and 'products' in tl:
        examples += [
            "Top 10 products by quantity ordered",
            "Monthly order revenue trend",
            "Orders count by country",
        ]
    if 'products' in tl and 'categories' in tl:
        examples += ["Revenue by product category"]
    if 'customers' in tl:
        examples += ["Top customers by total orders"]
    if 'employees' in tl:
        examples += ["Orders handled per employee"]
    if 'suppliers' in tl:
        examples += ["Products count by supplier"]
    if 'sales' in tl and 'items' in tl:
        examples += ["Sales chart item wise", "Monthly sales trend"]
    if 'purchases' in tl:
        examples += ["Monthly purchase trend"]

    # Generic fallbacks
    if not examples and table_names:
        examples = [
            f"Show top 10 records from {table_names[0]}",
            f"Count rows in {table_names[0]}",
            "Show data as a table",
            "Monthly trend",
        ]
    return examples


def _suggestions_for_table(table: str, all_tables: list[str]) -> list[str]:
    t = table.lower()
    tl = [x.lower() for x in all_tables]

    mapping = {
        'orders':       ["Monthly orders trend", "Orders by country", "Orders by customer"],
        'products':     ["Top products by price", "Products by category", "Products in stock"],
        'customers':    ["Customers by country", "Top customers by orders"],
        'order_details':["Top products by quantity ordered", "Revenue by product"],
        'categories':   ["Products per category", "Revenue by category"],
        'employees':    ["Orders per employee", "Employee sales performance"],
        'suppliers':    ["Products per supplier", "Suppliers by country"],
        'sales':        ["Sales item wise", "Monthly sales trend", "Top selling items"],
        'items':        ["Items by category", "Stock levels by item"],
        'purchases':    ["Monthly purchase trend", "Top purchased items"],
    }

    suggestions = mapping.get(t, [f"Show data from {table}", f"Count rows in {table}"])

    # Add cross-table suggestions if related tables exist
    if t == 'orders' and 'customers' in tl:
        suggestions.append("Orders grouped by customer name")
    if t == 'order_details' and 'products' in tl:
        suggestions.append("Revenue per product name")

    return suggestions


def _fuzzy_match(query: str, table: str) -> bool:
    """Basic fuzzy match — check if table root appears in query."""
    root = re.sub(r's$|_details$|_items$', '', table.lower())
    return root in query and len(root) > 3

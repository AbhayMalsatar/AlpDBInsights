"""Intent detection agent - identifies what the user wants to do."""
import re
from app.models.schemas import AIIntent


INTENT_PATTERNS = {
    AIIntent.create_chart: [
        r'\b(create|make|build|generate|add|show me|give me|plot|draw)\b.*\b(chart|graph|plot|visualization|visual|dashboard|kpi|table|trend|report)\b',
        r'\b(chart|graph|plot|visualize|display|show)\b.*\b(sales|purchase|revenue|stock|inventory|customer|product|item)\b',
        r'\b(top|bottom)\s+\d+\b',
        r'\b(item|product|category|region|month|weekly|daily|yearly)\s+(wise|by|based on)\b',
    ],
    AIIntent.modify_chart: [
        r'\b(change|modify|update|edit|transform|convert|switch)\b.*\b(chart|graph|type|color|title)\b',
        r'\b(make it|change to|convert to|switch to)\b.*\b(bar|line|pie|area|table)\b',
    ],
    AIIntent.delete_chart: [
        r'\b(delete|remove|drop|clear|hide)\b.*\b(chart|graph|widget|card)\b',
    ],
    AIIntent.create_tab: [
        r'\b(create|add|new)\b.*\b(tab|dashboard|page|section)\b',
    ],
    AIIntent.add_filter: [
        r'\b(add|create|set)\b.*\b(filter|filters)\b',
        r'\b(filter|limit|restrict)\b.*\b(by|to|for)\b',
    ],
}


def detect_intent(message: str) -> tuple[AIIntent, float]:
    """
    Returns (intent, confidence_score).
    Confidence is 0-1.
    """
    lower = message.lower()

    scores: dict[AIIntent, int] = {intent: 0 for intent in AIIntent}

    for intent, patterns in INTENT_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, lower):
                scores[intent] += 1

    best_intent = max(scores, key=lambda k: scores[k])
    best_score = scores[best_intent]

    if best_score == 0:
        # Default to create_chart if numbers/data keywords present
        data_keywords = ['sales', 'revenue', 'stock', 'purchase', 'order', 'profit', 'cost', 'inventory']
        if any(kw in lower for kw in data_keywords):
            return AIIntent.create_chart, 0.5
        return AIIntent.info, 0.3

    confidence = min(best_score / 3.0, 1.0)
    return best_intent, confidence


def extract_chart_hints(message: str) -> dict:
    """Extract chart type, time period, and entity hints from message."""
    lower = message.lower()

    chart_type = "bar"
    if any(w in lower for w in ["pie", "donut", "portion", "share", "distribution", "breakdown"]):
        chart_type = "pie"
    elif any(w in lower for w in ["line", "trend", "over time", "timeline", "progression"]):
        chart_type = "line"
    elif any(w in lower for w in ["area"]):
        chart_type = "area"
    elif any(w in lower for w in ["table", "list", "top", "bottom", "rank"]):
        chart_type = "table"
    elif any(w in lower for w in ["kpi", "card", "metric", "total", "count", "sum"]):
        chart_type = "kpi"

    time_period = None
    if "last 6 months" in lower or "6 month" in lower:
        time_period = "6_months"
    elif "last month" in lower or "this month" in lower:
        time_period = "1_month"
    elif "last year" in lower or "this year" in lower:
        time_period = "1_year"
    elif any(w in lower for w in ["monthly", "month wise", "per month"]):
        time_period = "monthly"
    elif any(w in lower for w in ["weekly", "week wise"]):
        time_period = "weekly"
    elif any(w in lower for w in ["daily", "day wise"]):
        time_period = "daily"

    limit = None
    top_match = re.search(r'\btop\s+(\d+)\b', lower)
    if top_match:
        limit = int(top_match.group(1))

    entity = None
    entities = ['sales', 'purchase', 'stock', 'inventory', 'revenue', 'profit',
                'customer', 'product', 'item', 'order', 'expense']
    for e in entities:
        if e in lower:
            entity = e
            break

    return {
        "chart_type": chart_type,
        "time_period": time_period,
        "limit": limit,
        "entity": entity,
    }

"""Pure helpers for dynamic per-org product attributes — no Django imports."""

MAX_ATTRIBUTE_KEYS_PER_ORG = 100
MAX_ATTRIBUTE_KEY_LEN = 128


def humanize_key(key):
    """'diameter_cm' -> 'Diameter Cm'."""
    return key.replace("_", " ").replace("-", " ").strip().title()


def infer_type(value):
    """Display hint from a first-seen value. Never enforced at ingest."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, (dict, list)):
        return "json"
    return "text"


def project_attributes(raw, visible):
    """Project a raw attribute dict through an org's visible schema.

    `raw` is Product.attributes (dict or None); `visible` is an ordered iterable
    of objects with `.key` and `.label`. Returns ``[{"key", "label", "value"}]``
    for keys present in `raw`, in schema order. Hidden keys are never included.
    """
    raw = raw or {}
    out = []
    for attr in visible:
        if attr.key in raw:
            out.append({"key": attr.key, "label": attr.label or attr.key, "value": raw[attr.key]})
    return out

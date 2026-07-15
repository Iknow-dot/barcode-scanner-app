"""Pure helpers for the pushed category ancestry chain — no Django imports."""


def normalize_category_chain(chain):
    """Validate and clean a pushed category chain.

    `chain` is the raw ``category`` value from a product push: a list of
    ``{"id": ..., "name": ...}`` objects ordered root -> leaf.

    Returns a list of ``{"id": str, "name": str}`` (ids/names coerced to
    stripped strings) or ``None`` when the chain is missing, empty, not a list,
    has an element without an id, or contains a duplicate id (a cycle or
    self-parent). ``None`` means "treat the product as uncategorized"; the
    caller must never abort the batch.
    """
    if not isinstance(chain, list) or not chain:
        return None
    cleaned = []
    seen = set()
    for node in chain:
        if not isinstance(node, dict):
            return None
        cid_raw = node.get("id")
        if cid_raw is None:
            return None
        cid = str(cid_raw).strip()
        if not cid or cid in seen:
            return None
        seen.add(cid)
        cleaned.append({"id": cid, "name": str(node.get("name") or "").strip()})
    return cleaned


def path_ids_string(chain):
    """Stable id materialized-path for the given (sub)chain, e.g. '/7/42/'."""
    if not chain:
        return ""
    return "/" + "/".join(node["id"] for node in chain) + "/"


def path_names(chain):
    """Display names root -> leaf for the given (sub)chain."""
    if not chain:
        return []
    return [node["name"] for node in chain]

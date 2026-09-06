"""DB-touching registration of newly-seen attribute keys. Org-scoped, capped."""
from core.catalog.attributes import (
    humanize_key, infer_type, MAX_ATTRIBUTE_KEYS_PER_ORG, MAX_ATTRIBUTE_KEY_LEN,
)
from core.models import ProductAttribute


def register_attribute_keys(organization, keys, first_seen_values=None):
    """Register unseen attribute keys for an org (hidden by default, inferred
    type, humanized label). Respects a per-org key cap and a key-length bound;
    keys past the cap are ignored for registration but their values are still
    stored by the caller. Idempotent."""
    first_seen_values = first_seen_values or {}
    existing = set(
        ProductAttribute.objects.filter(organization=organization).values_list("key", flat=True)
    )
    remaining = MAX_ATTRIBUTE_KEYS_PER_ORG - len(existing)
    if remaining <= 0:
        return
    to_create = []
    base_order = len(existing)
    for key in keys:
        if not key or key in existing or len(key) > MAX_ATTRIBUTE_KEY_LEN:
            continue
        if len(to_create) >= remaining:
            break
        to_create.append(ProductAttribute(
            organization=organization,
            key=key,
            label=humanize_key(key),
            order=base_order + len(to_create),
            is_visible=False,
            type=infer_type(first_seen_values.get(key)),
        ))
        existing.add(key)
    if to_create:
        ProductAttribute.objects.bulk_create(to_create, ignore_conflicts=True)

"""Per-batch category upsert for catalog ingest. DB-touching; strictly org-scoped."""
from django.db import IntegrityError

from .categories import normalize_category_chain, path_ids_string, path_names
from .models import ProductCategory


class CategoryResolver:
    """Resolves a pushed category chain to its leaf ProductCategory, creating or
    updating nodes as needed. Memoized per instance (one per push batch) so each
    distinct node is touched at most once. Every query is scoped to one org."""

    def __init__(self, organization):
        self.org = organization
        self._cache = {}  # external_id -> ProductCategory

    def resolve(self, raw_chain):
        chain = normalize_category_chain(raw_chain)
        if not chain:
            return None
        parent = None
        node = None
        for i, entry in enumerate(chain):
            node = self._upsert(entry["id"], entry["name"], parent, chain[: i + 1])
            parent = node
        return node

    def _upsert(self, external_id, name, parent, prefix):
        path = path_ids_string(prefix)
        names = path_names(prefix)
        cached = self._cache.get(external_id)
        if cached is not None:
            self._apply(cached, name, parent, path, names)
            return cached
        obj = ProductCategory.objects.filter(organization=self.org, external_id=external_id).first()
        if obj is None:
            try:
                obj = ProductCategory.objects.create(
                    organization=self.org, external_id=external_id, name=name,
                    parent=parent, path=path, path_names=names,
                )
            except IntegrityError:  # lost a create race with a concurrent page
                obj = ProductCategory.objects.get(organization=self.org, external_id=external_id)
                self._apply(obj, name, parent, path, names)
        else:
            self._apply(obj, name, parent, path, names)
        self._cache[external_id] = obj
        return obj

    def _apply(self, obj, name, parent, path, names):
        """Update a node in place when the push carries newer data, and
        propagate a name change to descendants outside the current chain."""
        renamed = obj.name != name
        changed = []
        if renamed:
            obj.name = name
            changed.append("name")
        parent_id = parent.id if parent else None
        if obj.parent_id != parent_id:
            obj.parent = parent
            changed.append("parent")
        if obj.path != path:
            obj.path = path
            changed.append("path")
        if obj.path_names != names:
            obj.path_names = names
            changed.append("path_names")
        if changed:
            obj.save(update_fields=changed)
        if renamed:
            self._refresh_descendants(obj.external_id, name)

    def _refresh_descendants(self, external_id, new_name):
        descendants = ProductCategory.objects.filter(
            organization=self.org, path__contains=f"/{external_id}/",
        ).exclude(external_id=external_id)
        to_update = []
        for d in descendants:
            ids = [p for p in d.path.split("/") if p]
            try:
                idx = ids.index(external_id)
            except ValueError:
                continue
            if idx < len(d.path_names) and d.path_names[idx] != new_name:
                d.path_names[idx] = new_name
                to_update.append(d)
        if to_update:
            ProductCategory.objects.bulk_update(to_update, ["path_names"])

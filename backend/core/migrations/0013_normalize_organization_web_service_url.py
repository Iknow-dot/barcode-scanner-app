"""Normalize Organization.web_service_url to the BASE URL only.

The field used to store the full product-search URL (e.g.
`http://host/db/HS/ConsultWebExchange/SomeEndpoint`). It is now the BASE URL
that the ConsultWebExchangeClient appends `HS/ConsultWebExchange/{name}` to,
so any existing values must have the suffix stripped.

The regex anchors to end-of-string so a `/hs/` segment that happens to appear
mid-URL is left alone. After stripping, any trailing `/` is removed.

Backward direction is a no-op: there's no way to recover the original
endpoint suffix once it's gone.
"""

import re

from django.db import migrations


_TRAILING_HS_RE = re.compile(r'/+hs/consultwebexchange.*$', re.IGNORECASE)


def forward(apps, schema_editor):
    Organization = apps.get_model('core', 'Organization')

    for org in Organization.objects.exclude(web_service_url='').iterator():
        original = org.web_service_url or ''
        cleaned = _TRAILING_HS_RE.sub('', original).rstrip('/')
        if cleaned != original:
            org.web_service_url = cleaned
            org.save(update_fields=['web_service_url'])
            print(
                f"[0013] Normalized web_service_url for org id={org.id}: "
                f"{original!r} -> {cleaned!r}"
            )


def backward(apps, schema_editor):
    """No-op: the original suffix is unrecoverable."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0012_remove_purchaseorder_customer'),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]

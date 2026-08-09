from django.db import migrations


def enable_catalog_for_orgs_with_products(apps, schema_editor):
    """Orgs already using the catalog keep it working after the feature gate ships."""
    Organization = apps.get_model('core', 'Organization')
    Organization.objects.filter(products__isnull=False).distinct().update(
        product_catalog_enabled=True,
    )


def noop(apps, schema_editor):
    # Reversing the schema migration drops the column; nothing to undo here.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0026_organization_product_catalog_enabled_and_more'),
    ]

    operations = [
        migrations.RunPython(enable_catalog_for_orgs_with_products, noop),
    ]

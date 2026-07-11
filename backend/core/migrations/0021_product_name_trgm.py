from django.db import migrations


def add_trgm(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    schema_editor.execute(
        "CREATE INDEX IF NOT EXISTS product_name_trgm ON core_product USING gin (name gin_trgm_ops)"
    )


def drop_trgm(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("DROP INDEX IF EXISTS product_name_trgm")


class Migration(migrations.Migration):
    dependencies = [("core", "0020_catalogingeststate_product_productbarcode_and_more")]
    operations = [migrations.RunPython(add_trgm, drop_trgm)]

import secrets

from django.db import migrations, models


def backfill_tokens(apps, schema_editor):
    Organization = apps.get_model("core", "Organization")
    for org in Organization.objects.all():
        org.webhook_token = secrets.token_urlsafe()
        org.save(update_fields=["webhook_token"])


class Migration(migrations.Migration):

    dependencies = [("core", "0018_purchaseorder_is_retail")]

    operations = [
        migrations.AddField(
            model_name="organization", name="webhook_token",
            field=models.CharField(default="", max_length=64),  # temp: non-unique
            preserve_default=False,
        ),
        migrations.RunPython(backfill_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="organization", name="webhook_token",
            field=models.CharField(default=secrets.token_urlsafe, max_length=64, unique=True, db_index=True),
        ),
    ]

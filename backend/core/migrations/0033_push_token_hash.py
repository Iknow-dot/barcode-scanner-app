"""Store only a hash of each organization's 1C push token.

State-only rename (webhook_token -> webhook_token_hash, same column), so code
that expects the new name works before this migration runs: DigitalOcean
deploys don't run migrations. The data step hashes tokens still stored in
plaintext; until it runs, core/ingest_auth.py hashes each one on first use.
"""
import hashlib
import re

from django.db import migrations, models

import core.models

_HASH = re.compile(r'[0-9a-f]{64}')


def hash_plaintext_push_tokens(apps, schema_editor):
    Organization = apps.get_model('core', 'Organization')
    for org in Organization.objects.only('pk', 'webhook_token_hash'):
        stored = org.webhook_token_hash or ''
        if not _HASH.fullmatch(stored):
            Organization.objects.filter(pk=org.pk).update(
                webhook_token_hash=hashlib.sha256(stored.encode('utf-8')).hexdigest(),
            )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0032_scanevent'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RenameField(
                    model_name='organization',
                    old_name='webhook_token',
                    new_name='webhook_token_hash',
                ),
                migrations.AlterField(
                    model_name='organization',
                    name='webhook_token_hash',
                    field=models.CharField(
                        db_column='webhook_token', db_index=True,
                        default=core.models._unrevealed_push_token_hash,
                        editable=False, max_length=64, unique=True,
                    ),
                ),
            ],
            database_operations=[],
        ),
        # Irreversible by nature: a hash can't be turned back into the token.
        migrations.RunPython(hash_plaintext_push_tokens, migrations.RunPython.noop),
    ]

from django.db import migrations


def enable_for_company_users(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='company_user').update(device_lock_enabled=True)


def disable_for_company_users(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(role='company_user').update(device_lock_enabled=False)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0005_device_lock_fields'),
    ]

    operations = [
        migrations.RunPython(enable_for_company_users, disable_for_company_users),
    ]

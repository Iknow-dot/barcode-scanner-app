"""Find (and optionally detach) warehouse memberships that break the same-org rule.

Every write path now enforces that a warehouse's members belong to the
warehouse's organization (API: users/serializers.py, core/serializers/warehouses.py;
admin: core/admin.py). Rows written before those guards can still exist, and they
are invisible in the admin — the Organization inline's picker is org-scoped, so a
foreign member is not rendered as an option and a plain re-save silently drops it.

Report only by default: which half is wrong is a judgement call. A membership on
the right warehouse whose user was moved to the wrong org is repaired by moving
the user back (PATCH the user's organization), not by deleting the row.
"""

from django.core.management.base import BaseCommand
from django.db.models import F

from core.models import Warehouse


class Command(BaseCommand):
    help = "Report warehouse memberships whose user belongs to another organization."

    def add_arguments(self, parser):
        parser.add_argument(
            '--detach',
            action='store_true',
            help="Delete the offending membership rows instead of only reporting them.",
        )

    def handle(self, *args, **options):
        # exclude() on the join renders as NOT (a = b AND a IS NOT NULL), so a
        # user with no organization is reported too — such a user can hold no
        # memberships at all.
        rows = (
            Warehouse.users.through.objects
            .exclude(user__organization_id=F('warehouse__organization_id'))
            .select_related('user', 'warehouse', 'warehouse__organization', 'user__organization')
            .order_by('warehouse__organization__name', 'warehouse__code', 'user__username')
        )
        count = 0
        for row in rows:
            count += 1
            user_org = row.user.organization.name if row.user.organization else '(none)'
            self.stdout.write(
                f"CROSS-ORG: warehouse {row.warehouse.code} "
                f"({row.warehouse.organization.name}) <- user {row.user.username} ({user_org})"
            )
        if not count:
            self.stdout.write("No cross-organization warehouse memberships.")
            return
        if options['detach']:
            deleted, _ = rows.delete()
            self.stdout.write(self.style.WARNING(f"Detached {deleted} membership(s)."))
        else:
            self.stdout.write(
                f"{count} membership(s) found. Re-run with --detach to remove them, or move "
                f"the users to the warehouse's organization if the membership is the correct half."
            )

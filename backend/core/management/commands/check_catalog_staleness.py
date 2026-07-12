from django.core.management.base import BaseCommand

from core.models import CatalogIngestState


class Command(BaseCommand):
    help = "Flag orgs whose catalog push has gone stale (no push within the SLA window)."

    def handle(self, *args, **options):
        stale = []
        for state in CatalogIngestState.objects.select_related("organization"):
            new_status = "stale" if state.is_stale else "ok"
            if state.status != new_status:
                state.status = new_status
                state.save(update_fields=["status"])
            if state.is_stale:
                stale.append(state.organization.name)
                self.stdout.write(f"STALE: {state.organization.name}")
        if not stale:
            self.stdout.write("All catalogs fresh.")

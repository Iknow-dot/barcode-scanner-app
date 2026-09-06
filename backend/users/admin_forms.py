from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import AdminUserCreationForm as DjangoAdminUserCreationForm
from django.contrib.auth.forms import UserChangeForm as DjangoUserChangeForm
from django.db import connection

class AdminUserCreationForm(DjangoAdminUserCreationForm):
    from users.models import User
    from core.models import Organization

    role = forms.ChoiceField(choices=User.Role.choices, required=True)
    organization = forms.ModelChoiceField(queryset=Organization.objects.all(), required=False)

    def save(self, commit=True):
        user = super().save(commit=False)
        user.role = self.cleaned_data['role']
        user.organization = self.cleaned_data['organization']
        if commit:
            user.save()
        return user


class AdminUserChangeForm(DjangoUserChangeForm):
    """Same-org rule for the admin change view: warehouses are attached from the
    Warehouse side and are not on this form, so moving a user to another org
    would silently leave cross-org memberships behind. Refuse until they are
    detached (the API requires warehouse_ids to be restated for the same reason).

    Only memberships that would END UP cross-org block the move, which matches
    the API rule and leaves the repair route open for a legacy row whose
    warehouse is right and whose ``user.organization`` is wrong."""

    class Meta(DjangoUserChangeForm.Meta):
        # The stock form's Meta binds to django.contrib.auth's User, which has
        # no `organization`; UserAdmin rebuilds the form per request, but a
        # directly-instantiated form must see the project's fields too.
        model = get_user_model()
        fields = '__all__'

    def clean(self):
        cleaned = super().clean()
        if not self.instance.pk or 'organization' not in self.changed_data:
            return cleaned
        # Hold the row for the rest of the request: ModelAdmin.changeform_view
        # wraps this in a transaction, so the lock spans clean() → save_model
        # and serializes against a concurrent warehouse attach (Postgres;
        # SQLite ignores it). The guard keeps a directly-instantiated form
        # (outside any transaction) from raising TransactionManagementError.
        if connection.in_atomic_block:
            get_user_model().objects.select_for_update().filter(pk=self.instance.pk).exists()
        target = cleaned.get('organization')
        if self.instance.warehouses.exclude(organization=target).exists():
            raise forms.ValidationError(
                "Remove the user from their warehouses before moving them to another organization."
            )
        return cleaned

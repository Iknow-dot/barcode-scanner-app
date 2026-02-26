from django import forms
from django.contrib.auth.forms import AdminUserCreationForm as DjangoAdminUserCreationForm

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

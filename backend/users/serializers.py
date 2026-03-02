from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from users.models import AllowedIP
from core.models import Warehouse


User = get_user_model()


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom JWT token serializer that adds user details (role, email,
    organization) as custom claims in the token and also returns them
    in the response body for convenience.

    The response body is shaped to match the contract expected by the
    React frontend (previously served by Flask):

        {
            "access_token": "...",
            "refresh_token": "...",
            "role": "company_user",
            "organization_id": 1,
            "organization_name": "Acme Corp",
            "warehouses": ["WH-01", "WH-02"],
            "user": {"id": 1, "username": "john"}
        }
    """

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        # Add custom claims to the JWT payload
        token['username'] = user.username
        token['email'] = user.email
        token['role'] = user.role
        if user.organization_id:
            token['organization_id'] = user.organization_id
        return token

    def validate(self, attrs):
        data = super().validate(attrs)

        # Rename keys to match the frontend expectation
        data['access_token'] = data.pop('access')
        data['refresh_token'] = data.pop('refresh')

        # Top-level fields the frontend reads directly
        data['role'] = self.user.role
        data['organization_id'] = self.user.organization_id
        data['organization_name'] = (
            self.user.organization.name if self.user.organization else None
        )

        # Warehouse names assigned to this user
        data['warehouses'] = list(
            self.user.warehouses.values_list('name', flat=True)
        )

        data['user'] = {
            'id': self.user.id,
            'username': self.user.username,
        }
        return data


class ClientIPSerializer(serializers.Serializer):
    ip = serializers.IPAddressField()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'role', 'organization']


class AllowedIPAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = AllowedIP
        fields = ["ip_or_network"]


class CompanyUserSerializer(serializers.ModelSerializer):
    """
    Serializer used by company admins to manage users in their organization.
    The organization and role are set automatically.
    """
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    allowed_ips = AllowedIPAddressSerializer(many=True, required=False)
    warehouse_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Warehouse.objects.all(),
        write_only=True,
        required=False,
        source='warehouses',
    )

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'role',
            'first_name',
            'last_name',
            'password',
            'is_active',
            'role',
            'allowed_ips',
            'warehouse_ids',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        password = validated_data.pop('password')
        warehouses = validated_data.pop('warehouses', [])
        validated_data.pop('allowed_ips', None)
        validated_data['organization'] = self.context['request'].user.organization
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        # Assign allowed IPs
        for ip_data in self.initial_data.get('allowed_ips', []):
            AllowedIP.objects.get_or_create(user=user, **ip_data)
        # Assign warehouses
        if warehouses:
            user.warehouses.set(warehouses)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        warehouses = validated_data.pop('warehouses', None)
        validated_data.pop('allowed_ips', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        # Update warehouses if provided
        if warehouses is not None:
            instance.warehouses.set(warehouses)
        # Update allowed IPs if provided
        if 'allowed_ips' in self.initial_data:
            instance.allowed_ips.all().delete()
            for ip_data in self.initial_data.get('allowed_ips', []):
                AllowedIP.objects.get_or_create(user=instance, **ip_data)
        return instance
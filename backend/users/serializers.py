from django.contrib.auth import get_user_model
from rest_framework import serializers


User = get_user_model()


class ClientIPSerializer(serializers.Serializer):
    ip_address = serializers.IPAddressField()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'role', 'organization']


class CompanyUserSerializer(serializers.ModelSerializer):
    """
    Serializer used by company admins to manage users in their organization.
    The organization and role are set automatically.
    """
    password = serializers.CharField(write_only=True, required=True, min_length=8)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'password', 'is_active',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        password = validated_data.pop('password')
        validated_data['role'] = User.Role.COMPANY_USER
        validated_data['organization'] = self.context['request'].user.organization
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance
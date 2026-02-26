from django.contrib.auth import get_user_model
from rest_framework import serializers


User = get_user_model()

class ClientIPSerializer(serializers.Serializer):
    ip_address = serializers.IPAddressField()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'role', 'organization']
from rest_framework import serializers


class ClientIPSerializer(serializers.Serializer):
    ip_address = serializers.IPAddressField()
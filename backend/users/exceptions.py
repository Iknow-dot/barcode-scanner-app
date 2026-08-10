class IPNotAllowedError(Exception):
    """Raised when a user's IP address is not in their allowed IPs list."""

    def __init__(self, client_ip=None):
        self.client_ip = client_ip
        super().__init__(f"IP address {client_ip} is not allowed.")


class DeviceNotAllowedError(Exception):
    """Raised when a device-locked user logs in from a non-bound device."""

    def __init__(self, device_id=None):
        self.device_id = device_id
        super().__init__("This device is not allowed for this user.")

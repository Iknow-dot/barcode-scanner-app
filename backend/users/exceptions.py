class IPNotAllowedError(Exception):
    """Raised when a user's IP address is not in their allowed IPs list."""

    def __init__(self, client_ip=None):
        self.client_ip = client_ip
        super().__init__(f"IP address {client_ip} is not allowed.")

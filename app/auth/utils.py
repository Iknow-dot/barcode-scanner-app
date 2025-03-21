import re
from datetime import datetime, timezone
from ipaddress import ip_address, AddressValueError

import jwt
from flask import current_app


def generate_jwt(user):
    expires_in = current_app.config['JWT_ACCESS_TOKEN_EXPIRES']
    exp = datetime.now(timezone.utc) + expires_in  # Correctly add timedelta to current time
    payload = {
        'sub': str(user.id),
        'role': user.role.role_name,  # Include user role in the token payload
        'exp': exp
    }
    if user.organization_id:  # Only add organization_id if it exists
        payload['organization_id'] = str(user.organization_id)

    token = jwt.encode(payload, current_app.config['JWT_SECRET_KEY'], algorithm='HS256')
    return token


def is_password_strong(password):
    if len(password) < 8:
        return False
    if not re.search(r"[A-Za-z]", password):
        return False
    if not re.search(r"\d", password):
        return False
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        return False
    return True


def is_valid_ip(ip):
    try:
        ip_address(ip)
        return True
    except AddressValueError:
        return False

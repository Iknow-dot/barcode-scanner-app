from flask import current_app as app

def register_commands():
    from . import create_user, seed_db  # Import commands

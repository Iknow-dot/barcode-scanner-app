from app import create_app, db
from app.models import User
import uuid

# Create a Flask application context
app = create_app()

with app.app_context():
    # Create a new user with the role of 'admin' (assuming role_id is a valid UUID for admin)
    role_id = uuid.UUID('7185189a-6d70-4153-a7f7-542cabdf4d97')  # Correct UUID format
    
    # Ensure to provide all required fields
    user = User(
        username='SysAdmin',
        role_id=role_id,
        organization_id=None,  # Provide a valid UUID or None if optional
        warehouse_id=None,     # Provide a valid UUID or None if optional
        ip_address='127.0.0.1' # Ensure a valid IP address format
    )

    # Set the password for the user (this will hash the password)
    user.set_password('Aa123456#')

    # Add the new user to the session
    db.session.add(user)

    # Commit the session to save the user in the database
    db.session.commit()

print("User created successfully")

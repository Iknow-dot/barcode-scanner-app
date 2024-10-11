from flask import Blueprint, jsonify, request, abort, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from sqlalchemy.exc import IntegrityError
from .models import Organization, Warehouse, User, UserRole, AllowedIP
from . import db
import uuid
import requests
from .decorators import role_required, organization_exists, ip_whitelisted
from sqlalchemy.orm import joinedload

# Create a blueprint
bp = Blueprint('routes', __name__)

# Home route
@bp.route('/')
def home():
    return jsonify({"message": "Welcome to the Barcode Scanner App!"})

# -------------------- Organization Routes -------------------- #

@bp.route('/organizations', methods=['GET'])
@jwt_required()
@role_required('admin', 'system_admin')
def get_organizations():
    identity = get_jwt_identity()
    user_id = identity.get('user_id') if isinstance(identity, dict) else identity
    current_user = User.query.get(uuid.UUID(user_id))

    # System Admin sees all organizations, Admin sees only their organization
    if current_user.is_system_admin():
        organizations = Organization.query.all()
    else:
        organizations = Organization.query.filter_by(id=current_user.organization_id).all()

    return jsonify([{
        "id": str(org.id),
        "name": org.name,
        "identification_code": org.identification_code,
        "web_service_url": org.web_service_url,
        "employees_count": org.employees_count  # Include employees_count
    } for org in organizations])

@bp.route('/organizations/<uuid:org_id>', methods=['GET'])
@jwt_required()
@role_required('admin', 'system_admin')
@organization_exists
def get_organization(organization):
    identity = get_jwt_identity()
    user_id = identity.get('user_id') if isinstance(identity, dict) else identity
    current_user = User.query.get(uuid.UUID(user_id))

    # Admins can only access their own organization's data
    if current_user.is_admin() and organization.id != current_user.organization_id:
        abort(403, description="Unauthorized to access this organization")

    return jsonify({
        "id": str(organization.id),
        "name": organization.name,
        "identification_code": organization.identification_code,
        "web_service_url": organization.web_service_url,
        "employees_count": organization.employees_count  # Include employees_count
    })

@bp.route('/organizations', methods=['POST'])
@jwt_required()
@role_required('system_admin')
def create_organization():
    data = request.get_json()

    # Check for missing fields
    if not data.get('name') or not data.get('identification_code') or not data.get('web_service_url') or not data.get('employees_count'):
        abort(400, description="Missing required fields")
    
    # Convert employees_count to integer and validate
    try:
        employees_count = int(data.get('employees_count'))
        if employees_count <= 0:
            abort(400, description="Employees count must be greater than zero")
    except ValueError:
        abort(400, description="Employees count must be a valid number")

    # Check if organization with the same identification_code already exists
    existing_organization = Organization.query.filter_by(identification_code=data['identification_code']).first()
    if existing_organization:
        abort(400, description="An organization with this identification code already exists")

    # Create the organization
    organization = Organization(
        id=uuid.uuid4(),
        name=data['name'],
        identification_code=data['identification_code'],
        web_service_url=data['web_service_url'],
        employees_count=employees_count  # Ensure employees_count is an integer
    )

    # Add the new organization to the database
    db.session.add(organization)
    db.session.commit()

    return jsonify({"message": "Organization created successfully", "id": str(organization.id)}), 201


@bp.route('/organizations/<uuid:org_id>', methods=['PUT'])
@jwt_required()
@role_required('system_admin')
@organization_exists
def update_organization(organization):
    data = request.get_json()

    if data.get('identification_code') and organization.identification_code != data['identification_code']:
        existing_organization = Organization.query.filter_by(identification_code=data['identification_code']).first()
        if existing_organization:
            abort(400, description="An organization with this identification code already exists")
    
    organization.name = data.get('name', organization.name)
    organization.identification_code = data.get('identification_code', organization.identification_code)
    organization.web_service_url = data.get('web_service_url', organization.web_service_url)
    
    # Handle employees_count field update
    if 'employees_count' in data:
        employees_count = int(data.get('employees_count', organization.employees_count))
        if employees_count <= 0:
            abort(400, description="Employees count must be greater than zero")
        organization.employees_count = employees_count
    
    db.session.commit()
    return jsonify({"message": "Organization updated successfully"})



@bp.route('/organizations/<uuid:org_id>', methods=['DELETE'])
@jwt_required()
@role_required('system_admin')
@organization_exists
def delete_organization(organization):
    current_app.logger.info(f"Deleting organization: {organization.id}, {organization.name}")
    db.session.delete(organization)
    db.session.commit()
    return '', 204


# -------------------- Warehouse Routes -------------------- #

@bp.route('/warehouses', methods=['GET'])
@jwt_required()
@role_required('admin', 'system_admin')
def get_warehouses():
    identity = get_jwt_identity()
    user_id = identity.get('user_id') if isinstance(identity, dict) else identity
    current_user = User.query.get(uuid.UUID(user_id))

    # System Admin sees all warehouses, Admin sees only their organization's warehouses
    if current_user.is_system_admin():
        warehouses = Warehouse.query.all()
    else:
        warehouses = Warehouse.query.filter_by(organization_id=current_user.organization_id).all()

    return jsonify([{
        "id": str(wh.id),
        "name": wh.name,
        "organization_id": str(wh.organization_id),
        "code": wh.code
    } for wh in warehouses])

@bp.route('/warehouses/<uuid:id>', methods=['GET'])
@jwt_required()
@role_required('admin', 'system_admin')
def get_warehouse(id):
    identity = get_jwt_identity()
    user_id = identity.get('user_id') if isinstance(identity, dict) else identity
    current_user = User.query.get(uuid.UUID(user_id))

    # System Admin can access any warehouse, Admin can only access their own organization's warehouses
    if current_user.is_system_admin():
        warehouse = Warehouse.query.get(id)
    else:
        warehouse = Warehouse.query.filter_by(id=id, organization_id=current_user.organization_id).first()

    if not warehouse:
        abort(403, description="Unauthorized to access this warehouse")

    return jsonify({
        "id": str(warehouse.id),
        "name": warehouse.name,
        "organization_id": str(warehouse.organization_id),
        "code": warehouse.code
    })

@bp.route('/warehouses', methods=['POST'])
@jwt_required()
@role_required('admin')
def create_warehouse():
    try:
        identity = get_jwt_identity()
        user_id = identity.get('user_id') if isinstance(identity, dict) else identity
        current_user = User.query.get(uuid.UUID(user_id))

        data = request.get_json() or {}
        name = data.get('name')

        if not name:
            return jsonify({'error': 'Missing warehouse name'}), 400

        warehouse = Warehouse(
            id=uuid.uuid4(),
            name=name,
            organization_id=current_user.organization_id,
            code=data.get('code')
        )

        db.session.add(warehouse)

        try:
            db.session.commit()
            return jsonify({
                "id": str(warehouse.id),
                "name": warehouse.name,
                "organization_id": str(warehouse.organization_id),
                "code": warehouse.code
            }), 201
        except IntegrityError:
            db.session.rollback()
            return jsonify({'error': 'Error creating warehouse. Please try again.'}), 500

    except Exception as e:
        current_app.logger.error(f"Error creating warehouse: {e}")
        return jsonify({'error': 'An error occurred while creating the warehouse'}), 500

@bp.route('/warehouses/<uuid:id>', methods=['PUT'])
@jwt_required()
@role_required('admin', 'system_admin')
def update_warehouse(id):
    try:
        identity = get_jwt_identity()
        user_id = identity.get('user_id') if isinstance(identity, dict) else identity
        current_user = User.query.get(uuid.UUID(user_id))

        warehouse = Warehouse.query.get(id)
        if not warehouse:
            return jsonify({'error': 'Warehouse not found'}), 404

        if current_user.is_admin() and current_user.organization_id != warehouse.organization_id:
            return jsonify({'error': 'Unauthorized to update this warehouse'}), 403

        data = request.get_json() or {}
        warehouse.name = data.get('name', warehouse.name)
        warehouse.code = data.get('code', warehouse.code)

        db.session.commit()
        return jsonify({"message": "Warehouse updated successfully"})
    except Exception as e:
        current_app.logger.error(f"Error updating warehouse: {e}")
        return jsonify({'error': 'An error occurred while updating the warehouse'}), 500

@bp.route('/warehouses/<uuid:id>', methods=['DELETE'])
@jwt_required()
@role_required('admin', 'system_admin')
def delete_warehouse(id):
    try:
        identity = get_jwt_identity()
        user_id = identity.get('user_id') if isinstance(identity, dict) else identity
        current_user = User.query.get(uuid.UUID(user_id))

        warehouse = Warehouse.query.get(id)
        if not warehouse:
            return jsonify({'error': 'Warehouse not found'}), 404

        if current_user.is_admin() and current_user.organization_id != warehouse.organization_id:
            return jsonify({'error': 'Unauthorized to delete this warehouse'}), 403

        db.session.delete(warehouse)
        db.session.commit()
        return '', 204
    except Exception as e:
        current_app.logger.error(f"Error deleting warehouse: {e}")
        return jsonify({'error': 'An error occurred while deleting the warehouse'}), 500

# -------------------- User Routes -------------------- #

@bp.route('/users', methods=['GET'])
@jwt_required()
@role_required('admin', 'system_admin')
def get_users():
    identity = get_jwt_identity()
    user_id = identity.get('user_id') if isinstance(identity, dict) else identity
    current_user = User.query.get(uuid.UUID(user_id))

    # System Admin sees all users, Admin sees only their organization's users
    if current_user.is_system_admin():
        users = User.query.options(joinedload(User.role)).all()
    else:
        users = User.query.options(joinedload(User.role)).filter_by(organization_id=current_user.organization_id).all()

    return jsonify([{
        "id": str(user.id),
        "username": user.username,
        "role_id": str(user.role_id),
        "role_name": user.role.role_name,  # This ensures role_name is included
        "organization_id": str(user.organization_id),
        "warehouse_id": str(user.warehouse_id) if user.warehouse_id else None,
        "ip_address": user.ip_address
    } for user in users])

@bp.route('/users/<uuid:user_id>', methods=['GET'])
@jwt_required()
@role_required('admin', 'system_admin')
def get_user(user_id):
    identity = get_jwt_identity()
    user_id = identity.get('user_id') if isinstance(identity, dict) else identity
    current_user = User.query.get(uuid.UUID(user_id))
    user = User.query.get(user_id)

    if not user:
        abort(404, description="User not found")

    # System Admin can access any user, Admin can only access their organization's users
    if current_user.is_admin() and current_user.organization_id != user.organization_id:
        abort(403, description="Unauthorized to access this user")

    return jsonify({
        "id": str(user.id),
        "username": user.username,
        "role_id": str(user.role_id),
        "organization_id": str(user.organization_id),
        "warehouse_id": str(user.warehouse_id) if user.warehouse_id else None,
        "ip_address": user.ip_address
    })

@bp.route('/users', methods=['POST'])
@jwt_required()
@role_required('admin', 'system_admin')
def create_user():
    try:
        identity = get_jwt_identity()
        user_id = identity.get('user_id') if isinstance(identity, dict) else identity
        current_user = User.query.get(uuid.UUID(user_id))

        data = request.get_json()
        current_app.logger.info(f"Received user data: {data}")

        if not data.get('username') or not data.get('password') or not data.get('role_name') or not data.get('organization_id') or not data.get('ip_address'):
            abort(400, description="Missing required fields")

        role = UserRole.query.filter_by(role_name=data['role_name']).first()
        if not role:
            abort(400, description="Invalid role name provided")

        existing_user = User.query.filter_by(username=data['username']).first()
        if existing_user:
            abort(400, description="Username already exists")

        try:
            organization_id = uuid.UUID(data['organization_id'])
            warehouse_id = uuid.UUID(data.get('warehouse_id')) if data.get('warehouse_id') else None
        except ValueError:
            abort(400, description="Invalid UUID format for organization or warehouse ID")

        # Get the organization and check the user limit
        organization = Organization.query.get(organization_id)
        if not organization:
            abort(404, description="Organization not found")

        # Count the existing users in the organization
        user_count = User.query.filter_by(organization_id=organization_id).count()

        # Check if the user count has reached the employees_count limit
        if user_count >= organization.employees_count:
            abort(400, description="User limit for this organization has been reached")

        # Proceed with creating the new user
        user = User(
            id=uuid.uuid4(),
            username=data['username'],
            role_id=role.id,
            organization_id=organization_id,
            warehouse_id=warehouse_id,
            ip_address=data['ip_address']
        )
        user.set_password(data['password'])

        db.session.add(user)
        db.session.commit()

        return jsonify({"message": "User created successfully", "id": str(user.id)}), 201

    except IntegrityError as e:
        current_app.logger.error(f"Database integrity error: {e}")
        db.session.rollback()
        abort(400, description="Database error, check if organization, warehouse, or user exists.")
    except ValueError as e:
        current_app.logger.error(f"Invalid UUID format: {e}")
        db.session.rollback()
        abort(400, description="Invalid UUID format.")
    except Exception as e:
        current_app.logger.error(f"Unexpected error: {e}")
        db.session.rollback()
        abort(500, description="An unexpected error occurred while creating the user.")


@bp.route('/users/<uuid:user_id>', methods=['PUT'])
@jwt_required()
@role_required('admin', 'system_admin')
def update_user(user_id):
    try:
        identity = get_jwt_identity()
        user_id = identity.get('user_id') if isinstance(identity, dict) else identity
        current_user = User.query.get(uuid.UUID(user_id))

        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        if current_user.is_admin() and current_user.organization_id != user.organization_id:
            return jsonify({'error': 'Unauthorized to update this user'}), 403

        data = request.get_json() or {}
        user.username = data.get('username', user.username)
        user.ip_address = data.get('ip_address', user.ip_address)

        db.session.commit()
        return jsonify({"message": "User updated successfully"})
    except Exception as e:
        current_app.logger.error(f"Error updating user: {e}")
        return jsonify({'error': 'An error occurred while updating the user'}), 500

@bp.route('/users/<uuid:user_id>', methods=['DELETE'])
@jwt_required()
@role_required('admin', 'system_admin')
def delete_user(user_id):
    try:
        identity = get_jwt_identity()
        user_id = identity.get('user_id') if isinstance(identity, dict) else identity
        current_user = User.query.get(uuid.UUID(user_id))

        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        if current_user.is_admin() and current_user.organization_id != user.organization_id:
            return jsonify({'error': 'Unauthorized to delete this user'}), 403

        db.session.delete(user)
        db.session.commit()
        return '', 204
    except Exception as e:
        current_app.logger.error(f"Error deleting user: {e}")
        return jsonify({'error': 'An error occurred while deleting the user'}), 500

# -------------------- Barcode Scanning Route -------------------- #

@bp.route('/scan', methods=['POST'])
@jwt_required()
@role_required('user')
@ip_whitelisted
def scan_barcode():
    data = request.get_json()
    barcode = data.get('barcode')

    if not barcode:
        abort(400, description="Missing barcode")

    user_id = get_jwt_identity()['user_id']
    user = User.query.get(uuid.UUID(user_id))
    organization = Organization.query.get(user.organization_id)

    response = requests.get(f"{organization.web_service_url}/products/{barcode}")

    if response.status_code != 200:
        return jsonify({"error": "Product not found"}), 404

    product_data = response.json()
    return jsonify(product_data), 200

# -------------------- IP Management Routes -------------------- #

@bp.route('/ips', methods=['POST'])
@jwt_required()
@role_required('admin')
def add_ip():
    data = request.get_json()
    ip_address = data.get('ip_address')
    user_id = uuid.UUID(data.get('user_id'))

    user = User.query.get(user_id)
    if not user:
        abort(404, description="User not found")

    allowed_ip = AllowedIP(ip_address=ip_address, user_id=user.id)
    db.session.add(allowed_ip)
    db.session.commit()

    return jsonify({"message": "IP added successfully", "id": allowed_ip.id}), 201

@bp.route('/ips/<int:ip_id>', methods=['DELETE'])
@jwt_required()
@role_required('admin')
def delete_ip(ip_id):
    allowed_ip = AllowedIP.query.get(ip_id)
    if not allowed_ip:
        abort(404, description="IP not found")

    db.session.delete(allowed_ip)
    db.session.commit()
    return jsonify({"message": "IP deleted successfully"})

# Register the blueprint with the Flask app
def register_routes(app):
    app.register_blueprint(bp)

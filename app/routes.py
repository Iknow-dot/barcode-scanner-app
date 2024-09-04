from flask import Blueprint, jsonify, request, abort
from flask_login import login_required, current_user
from .models import Organization, Warehouse, User, UserRole
from . import db
import uuid

# Create a blueprint
bp = Blueprint('routes', __name__)

# Home route
@bp.route('/')
def home():
    return jsonify({"message": "Welcome to the Barcode Scanner App!"})

# Route to get all organizations
@bp.route('/organizations', methods=['GET'])
@login_required
def get_organizations():
    organizations = Organization.query.all()
    return jsonify([{
        "id": str(org.id),
        "name": org.name,
        "identification_code": org.identification_code,
        "web_service_address": org.web_service_url
    } for org in organizations])

# Route to get a specific organization by ID
@bp.route('/organizations/<uuid:org_id>', methods=['GET'])
@login_required
def get_organization(org_id):
    organization = Organization.query.get(org_id)
    if organization is None:
        abort(404, description="Organization not found")
    return jsonify({
        "id": str(organization.id),
        "name": organization.name,
        "identification_code": organization.identification_code,
        "web_service_address": organization.web_service_url
    })

# Route to create a new organization
@bp.route('/organizations', methods=['POST'])
@login_required
def create_organization():
    data = request.get_json()
    if not data.get('name') or not data.get('identification_code') or not data.get('web_service_url'):
        abort(400, description="Missing required fields")

    organization = Organization(
        id=uuid.uuid4(),
        name=data['name'],
        identification_code=data['identification_code'],
        web_service_url=data['web_service_url']
    )
    db.session.add(organization)
    db.session.commit()
    return jsonify({"message": "Organization created successfully", "id": str(organization.id)}), 201

# Route to update an existing organization
@bp.route('/organizations/<uuid:org_id>', methods=['PUT'])
@login_required
def update_organization(org_id):
    organization = Organization.query.get(org_id)
    if organization is None:
        abort(404, description="Organization not found")
    
    data = request.get_json()
    organization.name = data.get('name', organization.name)
    organization.identification_code = data.get('identification_code', organization.identification_code)
    organization.web_service_url = data.get('web_service_url', organization.web_service_url)

    db.session.commit()
    return jsonify({"message": "Organization updated successfully"})

# Route to delete an organization
@bp.route('/organizations/<uuid:org_id>', methods=['DELETE'])
@login_required
def delete_organization(org_id):
    organization = Organization.query.get(org_id)
    if organization is None:
        abort(404, description="Organization not found")
    
    db.session.delete(organization)
    db.session.commit()
    return jsonify({"message": "Organization deleted successfully"}), 204

# Route to get all warehouses
@bp.route('/warehouses', methods=['GET'])
@login_required
def get_warehouses():
    warehouses = Warehouse.query.all()
    return jsonify([{
        "id": str(wh.id),
        "organization_id": str(wh.organization_id),
        "name": wh.name,
        "location": wh.location
    } for wh in warehouses])

# Route to get a specific warehouse by ID
@bp.route('/warehouses/<uuid:wh_id>', methods=['GET'])
@login_required
def get_warehouse(wh_id):
    warehouse = Warehouse.query.get(wh_id)
    if warehouse is None:
        abort(404, description="Warehouse not found")
    return jsonify({
        "id": str(warehouse.id),
        "organization_id": str(warehouse.organization_id),
        "name": warehouse.name,
        "location": warehouse.location
    })

# Route to create a new warehouse
@bp.route('/warehouses', methods=['POST'])
@login_required
def create_warehouse():
    data = request.get_json()
    if not data.get('organization_id') or not data.get('name') or not data.get('location'):
        abort(400, description="Missing required fields")

    warehouse = Warehouse(
        id=uuid.uuid4(),
        organization_id=data['organization_id'],
        name=data['name'],
        location=data['location']
    )
    db.session.add(warehouse)
    db.session.commit()
    return jsonify({"message": "Warehouse created successfully", "id": str(warehouse.id)}), 201

# Route to update an existing warehouse
@bp.route('/warehouses/<uuid:wh_id>', methods=['PUT'])
@login_required
def update_warehouse(wh_id):
    warehouse = Warehouse.query.get(wh_id)
    if warehouse is None:
        abort(404, description="Warehouse not found")
    
    data = request.get_json()
    warehouse.name = data.get('name', warehouse.name)
    warehouse.location = data.get('location', warehouse.location)
    
    db.session.commit()
    return jsonify({"message": "Warehouse updated successfully"})

# Route to delete a warehouse
@bp.route('/warehouses/<uuid:wh_id>', methods=['DELETE'])
@login_required
def delete_warehouse(wh_id):
    warehouse = Warehouse.query.get(wh_id)
    if warehouse is None:
        abort(404, description="Warehouse not found")
    
    db.session.delete(warehouse)
    db.session.commit()
    return jsonify({"message": "Warehouse deleted successfully"}), 204

# Route to get all users (Admin only)
@bp.route('/users', methods=['GET'])
@login_required
def get_users():
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    users = User.query.all()
    return jsonify([{
        "id": str(user.id),
        "username": user.username,
        "role_id": str(user.role_id),
        "organization_id": str(user.organization_id),
        "warehouse_id": str(user.warehouse_id),
        "ip_address": user.ip_address
    } for user in users])

# Route to get a specific user by ID (Admin only)
@bp.route('/users/<uuid:user_id>', methods=['GET'])
@login_required
def get_user(user_id):
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    user = User.query.get(user_id)
    if user is None:
        abort(404, description="User not found")
    return jsonify({
        "id": str(user.id),
        "username": user.username,
        "role_id": str(user.role_id),
        "organization_id": str(user.organization_id),
        "warehouse_id": str(user.warehouse_id),
        "ip_address": user.ip_address
    })

# Route to create a new user (Admin only)
@bp.route('/users', methods=['POST'])
@login_required
def create_user():
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    data = request.get_json()
    if not data.get('username') or not data.get('role_id') or not data.get('ip_address'):
        abort(400, description="Missing required fields")
    
    user = User(
        id=uuid.uuid4(),
        username=data['username'],
        role_id=data['role_id'],
        organization_id=data.get('organization_id'),
        warehouse_id=data.get('warehouse_id'),
        ip_address=data['ip_address']
    )
    db.session.add(user)
    db.session.commit()
    return jsonify({"message": "User created successfully", "id": str(user.id)}), 201

# Route to update an existing user (Admin only)
@bp.route('/users/<uuid:user_id>', methods=['PUT'])
@login_required
def update_user(user_id):
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    user = User.query.get(user_id)
    if user is None:
        abort(404, description="User not found")
    
    data = request.get_json()
    user.username = data.get('username', user.username)
    user.role_id = data.get('role_id', user.role_id)
    user.organization_id = data.get('organization_id', user.organization_id)
    user.warehouse_id = data.get('warehouse_id', user.warehouse_id)
    user.ip_address = data.get('ip_address', user.ip_address)
    
    db.session.commit()
    return jsonify({"message": "User updated successfully"})

# Route to delete a user (Admin only)
@bp.route('/users/<uuid:user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    user = User.query.get(user_id)
    if user is None:
        abort(404, description="User not found")
    
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "User deleted successfully"}), 204

# Route to get all user roles (Admin only)
@bp.route('/roles', methods=['GET'])
@login_required
def get_roles():
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    roles = UserRole.query.all()
    return jsonify([{
        "id": str(role.id),
        "role_name": role.role_name
    } for role in roles])

# Route to get a specific user role by ID (Admin only)
@bp.route('/roles/<uuid:role_id>', methods=['GET'])
@login_required
def get_role(role_id):
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    role = UserRole.query.get(role_id)
    if role is None:
        abort(404, description="Role not found")
    return jsonify({
        "id": str(role.id),
        "role_name": role.role_name
    })

# Route to create a new user role (Admin only)
@bp.route('/roles', methods=['POST'])
@login_required
def create_role():
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    data = request.get_json()
    if not data.get('role_name'):
        abort(400, description="Missing required fields")
    
    role = UserRole(
        id=uuid.uuid4(),
        role_name=data['role_name']
    )
    db.session.add(role)
    db.session.commit()
    return jsonify({"message": "Role created successfully", "id": str(role.id)}), 201

# Route to update an existing user role (Admin only)
@bp.route('/roles/<uuid:role_id>', methods=['PUT'])
@login_required
def update_role(role_id):
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    role = UserRole.query.get(role_id)
    if role is None:
        abort(404, description="Role not found")
    
    data = request.get_json()
    role.role_name = data.get('role_name', role.role_name)
    
    db.session.commit()
    return jsonify({"message": "Role updated successfully"})

# Route to delete a user role (Admin only)
@bp.route('/roles/<uuid:role_id>', methods=['DELETE'])
@login_required
def delete_role(role_id):
    if not current_user.is_admin():
        return jsonify({"error": "Unauthorized access"}), 403
    
    role = UserRole.query.get(role_id)
    if role is None:
        abort(404, description="Role not found")
    
    db.session.delete(role)
    db.session.commit()
    return jsonify({"message": "Role deleted successfully"}), 204

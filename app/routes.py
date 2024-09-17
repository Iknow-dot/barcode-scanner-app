from flask import Blueprint, jsonify, request, abort
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.exc import IntegrityError
from .models import Organization, Warehouse, User, UserRole, AllowedIP
from . import db
import uuid
import requests
from .decorators import role_required, organization_exists, ip_whitelisted

# Create a blueprint
bp = Blueprint('routes', __name__)

# Home route
@bp.route('/')
def home():
    return jsonify({"message": "Welcome to the Barcode Scanner App!"})

# -------------------- Organization Routes -------------------- #

@bp.route('/organizations', methods=['GET'])
@jwt_required()
@role_required('admin')
def get_organizations():
    organizations = Organization.query.all()
    return jsonify([{
        "id": str(org.id),
        "name": org.name,
        "identification_code": org.identification_code,
        "web_service_url": org.web_service_url
    } for org in organizations])

@bp.route('/organizations/<uuid:org_id>', methods=['GET'])
@jwt_required()
@role_required('admin')
@organization_exists
def get_organization(organization):
    return jsonify({
        "id": str(organization.id),
        "name": organization.name,
        "identification_code": organization.identification_code,
        "web_service_url": organization.web_service_url
    })

@bp.route('/organizations', methods=['POST'])
@jwt_required()
@role_required('admin')
def create_organization():
    data = request.get_json()
    if not data.get('name') or not data.get('identification_code') or not data.get('web_service_url'):
        abort(400, description="Missing required fields")

    existing_organization = Organization.query.filter_by(identification_code=data['identification_code']).first()
    if existing_organization:
        abort(400, description="An organization with this identification code already exists")

    organization = Organization(
        id=uuid.uuid4(),
        name=data['name'],
        identification_code=data['identification_code'],
        web_service_url=data['web_service_url']
    )
    db.session.add(organization)
    db.session.commit()

    return jsonify({"message": "Organization created successfully", "id": str(organization.id)}), 201

@bp.route('/organizations/<uuid:org_id>', methods=['PUT'])
@jwt_required()
@role_required('admin')
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

    db.session.commit()
    return jsonify({"message": "Organization updated successfully"})

@bp.route('/organizations/<uuid:org_id>', methods=['DELETE'])
@jwt_required()
@role_required('admin')
@organization_exists
def delete_organization(organization):
    db.session.delete(organization)
    db.session.commit()
    return '', 204

# -------------------- Warehouse Routes -------------------- #

@bp.route('/warehouses', methods=['GET'])
@jwt_required()
@role_required('admin')
def get_warehouses():
    warehouses = Warehouse.query.all()
    return jsonify([{
        "id": str(wh.id),
        "name": wh.name,
        "organization_id": str(wh.organization_id),
        "location": wh.location
    } for wh in warehouses])

@bp.route('/warehouses/<uuid:id>', methods=['GET'])
@jwt_required()
@role_required('admin')
def get_warehouse(id):
    warehouse = Warehouse.query.get_or_404(id)
    return jsonify({
        "id": str(warehouse.id),
        "name": warehouse.name,
        "organization_id": str(warehouse.organization_id),
        "location": warehouse.location
    })

@bp.route('/warehouses', methods=['POST'])
@jwt_required()
@role_required('admin')
def create_warehouse():
    data = request.get_json() or {}
    name = data.get('name')
    organization_id = data.get('organization_id')

    if not name or not organization_id:
        return jsonify({'error': 'Missing name or organization_id'}), 400

    organization = Organization.query.get(uuid.UUID(organization_id))
    if not organization:
        return jsonify({'error': 'Invalid organization ID'}), 400

    warehouse = Warehouse(name=name, organization_id=organization.id, location=data.get('location'))
    db.session.add(warehouse)
    try:
        db.session.commit()
        return jsonify({
            "id": str(warehouse.id),
            "name": warehouse.name,
            "organization_id": str(warehouse.organization_id),
            "location": warehouse.location
        }), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Error creating warehouse. Please try again.'}), 500

@bp.route('/warehouses/<uuid:id>', methods=['PUT'])
@jwt_required()
@role_required('admin')
def update_warehouse(id):
    data = request.get_json() or {}
    warehouse = Warehouse.query.get_or_404(id)

    if 'name' in data:
        warehouse.name = data['name']
    if 'organization_id' in data:
        organization = Organization.query.get(uuid.UUID(data['organization_id']))
        if not organization:
            return jsonify({'error': 'Invalid organization ID'}), 400
        warehouse.organization_id = organization.id
    if 'location' in data:
        warehouse.location = data['location']

    try:
        db.session.commit()
        return jsonify({
            "id": str(warehouse.id),
            "name": warehouse.name,
            "organization_id": str(warehouse.organization_id),
            "location": warehouse.location
        })
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Error updating warehouse. Please try again.'}), 500

@bp.route('/warehouses/<uuid:id>', methods=['DELETE'])
@jwt_required()
@role_required('admin')
def delete_warehouse(id):
    warehouse = Warehouse.query.get_or_404(id)
    db.session.delete(warehouse)
    db.session.commit()
    return jsonify({'message': 'Warehouse deleted'})

# -------------------- User Routes -------------------- #

@bp.route('/users', methods=['GET'])
@jwt_required()
@role_required('admin')
def get_users():
    users = User.query.all()
    return jsonify([{
        "id": str(user.id),
        "username": user.username,
        "role_id": str(user.role_id),
        "organization_id": str(user.organization_id),
        "warehouse_id": str(user.warehouse_id),
        "ip_address": user.ip_address
    } for user in users])

@bp.route('/users/<uuid:user_id>', methods=['GET'])
@jwt_required()
@role_required('admin')
def get_user(user_id):
    user = User.query.get(user_id)
    if user is None:
        abort(404, description="User not found")
    return jsonify({
        "id": str(user.id),
        "username": user.username,
        "role_id": str(user.role_id),
        "organization_id": user.organization_id,
        "warehouse_id": user.warehouse_id,
        "ip_address": user.ip_address
    })

@bp.route('/users', methods=['POST'])
@jwt_required()
@role_required('admin')
def create_user():
    data = request.get_json()
    if not data.get('username') or not data.get('role_id') or not data.get('ip_address'):
        abort(400, description="Missing required fields")

    existing_user = User.query.filter_by(username=data['username']).first()
    if existing_user:
        abort(400, description="Username already exists")

    user = User(
        id=uuid.uuid4(),
        username=data['username'],
        role_id=uuid.UUID(data['role_id']),
        organization_id=uuid.UUID(data.get('organization_id')),
        warehouse_id=uuid.UUID(data.get('warehouse_id')) if data.get('warehouse_id') else None,
        ip_address=data['ip_address']
    )
    user.set_password(data['password'])  # Use set_password method

    db.session.add(user)
    db.session.commit()
    return jsonify({"message": "User created successfully", "id": str(user.id)}), 201

@bp.route('/users/<uuid:user_id>', methods=['PUT'])
@jwt_required()
@role_required('admin')
def update_user(user_id):
    user = User.query.get(user_id)
    if user is None:
        abort(404, description="User not found")

    data = request.get_json()
    if 'username' in data:
        user.username = data['username']
    if 'role_id' in data:
        user.role_id = uuid.UUID(data['role_id'])
    if 'organization_id' in data:
        user.organization_id = uuid.UUID(data['organization_id'])
    if 'warehouse_id' in data:
        user.warehouse_id = uuid.UUID(data['warehouse_id'])
    if 'ip_address' in data:
        user.ip_address = data['ip_address']
    if 'password' in data:
        user.set_password(data['password'])

    db.session.commit()
    return jsonify({"message": "User updated successfully"})

@bp.route('/users/<uuid:user_id>', methods=['DELETE'])
@jwt_required()
@role_required('admin')
def delete_user(user_id):
    user = User.query.get(user_id)
    if user is None:
        abort(404, description="User not found")

    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "User deleted successfully"})

# -------------------- Authentication Routes -------------------- #

@bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data.get('username') or not data.get('password') or not data.get('role_id'):
        abort(400, description="Missing required fields")

    user = User(
        id=uuid.uuid4(),
        username=data['username'],
        role_id=uuid.UUID(data['role_id']),
        ip_address=data.get('ip_address')
    )
    user.set_password(data['password'])

    db.session.add(user)
    db.session.commit()
    return jsonify({"message": "User registered successfully", "id": str(user.id)}), 201

@bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({'error': 'Invalid credentials'}), 401

    access_token = create_access_token(identity={"user_id": str(user.id), "role_id": str(user.role_id)})
    return jsonify(access_token=access_token)

@bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    return jsonify({"message": "Logged out successfully"}), 200

# -------------------- Barcode Scanning Route -------------------- #

@bp.route('/scan', methods=['POST'])
@jwt_required()
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

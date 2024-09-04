# app/routes.py
from flask import Blueprint, jsonify, request, abort
from .models import Organization, Warehouse, User, UserRole
from . import db

# Create a blueprint
bp = Blueprint('routes', __name__)

# Home route
@bp.route('/')
def home():
    return jsonify({"message": "Welcome to the Barcode Scanner App!"})

# Route to get all organizations
@bp.route('/organizations', methods=['GET'])
def get_organizations():
    organizations = Organization.query.all()
    return jsonify([{
        "id": str(org.id),
        "name": org.name,
        "identification_code": org.identification_code,
        "web_service_address": org.web_service_address
    } for org in organizations])

# Route to get a specific organization by ID
@bp.route('/organizations/<uuid:org_id>', methods=['GET'])
def get_organization(org_id):
    organization = Organization.query.get(org_id)
    if organization is None:
        abort(404)
    return jsonify({
        "id": str(organization.id),
        "name": organization.name,
        "identification_code": organization.identification_code,
        "web_service_address": organization.web_service_address
    })

# Route to get all warehouses
@bp.route('/warehouses', methods=['GET'])
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
def get_warehouse(wh_id):
    warehouse = Warehouse.query.get(wh_id)
    if warehouse is None:
        abort(404)
    return jsonify({
        "id": str(warehouse.id),
        "organization_id": str(warehouse.organization_id),
        "name": warehouse.name,
        "location": warehouse.location
    })

# Route to get all users
@bp.route('/users', methods=['GET'])
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

# Route to get a specific user by ID
@bp.route('/users/<uuid:user_id>', methods=['GET'])
def get_user(user_id):
    user = User.query.get(user_id)
    if user is None:
        abort(404)
    return jsonify({
        "id": str(user.id),
        "username": user.username,
        "role_id": str(user.role_id),
        "organization_id": str(user.organization_id),
        "warehouse_id": str(user.warehouse_id),
        "ip_address": user.ip_address
    })

# Route to scan a barcode and get product details
@bp.route('/scan', methods=['POST'])
def scan_barcode():
    data = request.get_json()
    barcode = data.get('barcode')
    
    if not barcode:
        return jsonify({"error": "Barcode is required"}), 400
    
    # Simulate external service call
    # For example purposes only; replace with actual service call
    product_data = {
        "barcode": barcode,
        "name": "Sample Product",
        "description": "This is a sample product description",
        "price": 10.99
    }
    
    return jsonify(product_data)

# Example route for testing purposes
@bp.route('/test', methods=['GET'])
def test():
    return jsonify({"message": "Test route is working!"})

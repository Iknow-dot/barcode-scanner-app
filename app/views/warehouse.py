from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Warehouse

bp = Blueprint('warehouse', __name__)

@bp.route('/warehouses', methods=['GET'])
@jwt_required()  # Add JWT authentication to this route
def get_warehouses():
    """Retrieve a list of all warehouses."""
    warehouses = Warehouse.query.all()
    return jsonify([wh.to_dict() for wh in warehouses])

@bp.route('/warehouses/<int:id>', methods=['GET'])
@jwt_required()  # Add JWT authentication to this route
def get_warehouse(id):
    """Retrieve a single warehouse by ID."""
    warehouse = Warehouse.query.get_or_404(id)
    return jsonify(warehouse.to_dict())

@bp.route('/warehouses', methods=['POST'])
@jwt_required()  # Add JWT authentication to this route
def create_warehouse():
    """Create a new warehouse."""
    data = request.get_json() or {}
    if 'name' not in data or 'organization_id' not in data:
        return jsonify({'error': 'Missing name or organization_id'}), 400
    
    # Example: check if the user has a specific role
    current_user = get_jwt_identity()
    # Assume 'admin' role is required to create a warehouse (change according to your logic)
    if current_user['role_name'] != 'admin':
        return jsonify({'error': 'Insufficient permissions'}), 403
    
    warehouse = Warehouse(name=data['name'], organization_id=data['organization_id'])
    db.session.add(warehouse)
    db.session.commit()
    return jsonify(warehouse.to_dict()), 201

@bp.route('/warehouses/<int:id>', methods=['PUT'])
@jwt_required()  # Add JWT authentication to this route
def update_warehouse(id):
    """Update an existing warehouse."""
    data = request.get_json() or {}
    warehouse = Warehouse.query.get_or_404(id)
    
    # Example: check if the user has a specific role
    current_user = get_jwt_identity()
    # Assume 'admin' role is required to update a warehouse (change according to your logic)
    if current_user['role_name'] != 'admin':
        return jsonify({'error': 'Insufficient permissions'}), 403
    
    if 'name' in data:
        warehouse.name = data['name']
    if 'organization_id' in data:
        warehouse.organization_id = data['organization_id']
    db.session.commit()
    return jsonify(warehouse.to_dict())

@bp.route('/warehouses/<int:id>', methods=['DELETE'])
@jwt_required()  # Add JWT authentication to this route
def delete_warehouse(id):
    """Delete a warehouse."""
    warehouse = Warehouse.query.get_or_404(id)
    
    # Example: check if the user has a specific role
    current_user = get_jwt_identity()
    # Assume 'admin' role is required to delete a warehouse (change according to your logic)
    if current_user['role_name'] != 'admin':
        return jsonify({'error': 'Insufficient permissions'}), 403
    
    db.session.delete(warehouse)
    db.session.commit()
    return jsonify({'message': 'Deleted'})

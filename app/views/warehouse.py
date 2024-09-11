from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Warehouse, User, Organization
from sqlalchemy.exc import IntegrityError
import uuid

bp = Blueprint('warehouse', __name__, url_prefix='/warehouses')

@bp.route('', methods=['GET'])
@jwt_required()
def get_warehouses():
    """Retrieve a list of all warehouses."""
    warehouses = Warehouse.query.all()
    return jsonify([wh.to_dict() for wh in warehouses])

@bp.route('/<uuid:id>', methods=['GET'])
@jwt_required()
def get_warehouse(id):
    """Retrieve a single warehouse by ID."""
    warehouse = Warehouse.query.get_or_404(id)
    return jsonify(warehouse.to_dict())

@bp.route('', methods=['POST'])
@jwt_required()
def create_warehouse():
    """Create a new warehouse."""
    data = request.get_json() or {}
    name = data.get('name')
    organization_id = data.get('organization_id')

    if not name or not organization_id:
        return jsonify({'error': 'Missing name or organization_id'}), 400
    
    # Validate organization_id
    organization = Organization.query.get(organization_id)
    if not organization:
        return jsonify({'error': 'Invalid organization ID'}), 400

    current_user = get_jwt_identity()
    user = User.query.get(current_user['user_id'])  # Adjust based on how user ID is stored
    if not user.is_admin():
        return jsonify({'error': 'Insufficient permissions'}), 403
    
    warehouse = Warehouse(name=name, organization_id=organization_id)
    db.session.add(warehouse)
    try:
        db.session.commit()
        return jsonify(warehouse.to_dict()), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Error creating warehouse. Please try again.'}), 500

@bp.route('/<uuid:id>', methods=['PUT'])
@jwt_required()
def update_warehouse(id):
    """Update an existing warehouse."""
    data = request.get_json() or {}
    warehouse = Warehouse.query.get_or_404(id)

    current_user = get_jwt_identity()
    user = User.query.get(current_user['user_id'])  # Adjust based on how user ID is stored
    if not user.is_admin():
        return jsonify({'error': 'Insufficient permissions'}), 403

    if 'name' in data:
        warehouse.name = data['name']
    if 'organization_id' in data:
        organization = Organization.query.get(data['organization_id'])
        if not organization:
            return jsonify({'error': 'Invalid organization ID'}), 400
        warehouse.organization_id = data['organization_id']
    if 'location' in data:
        warehouse.location = data['location']
    
    try:
        db.session.commit()
        return jsonify(warehouse.to_dict())
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Error updating warehouse. Please try again.'}), 500

@bp.route('/<uuid:id>', methods=['DELETE'])
@jwt_required()
def delete_warehouse(id):
    """Delete a warehouse."""
    warehouse = Warehouse.query.get_or_404(id)

    current_user = get_jwt_identity()
    user = User.query.get(current_user['user_id'])  # Adjust based on how user ID is stored
    if not user.is_admin():
        return jsonify({'error': 'Insufficient permissions'}), 403

    try:
        db.session.delete(warehouse)
        db.session.commit()
        return jsonify({'message': 'Warehouse deleted'})
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Error deleting warehouse. Please try again.'}), 500

# app/views/warehouse.py

from flask import Blueprint, request, jsonify
from app import db
from app.models import Warehouse

bp = Blueprint('warehouse', __name__)

@bp.route('/warehouses', methods=['GET'])
def get_warehouses():
    """Retrieve a list of all warehouses."""
    warehouses = Warehouse.query.all()
    return jsonify([wh.to_dict() for wh in warehouses])

@bp.route('/warehouses/<int:id>', methods=['GET'])
def get_warehouse(id):
    """Retrieve a single warehouse by ID."""
    warehouse = Warehouse.query.get_or_404(id)
    return jsonify(warehouse.to_dict())

@bp.route('/warehouses', methods=['POST'])
def create_warehouse():
    """Create a new warehouse."""
    data = request.get_json() or {}
    if 'name' not in data or 'organization_id' not in data:
        return jsonify({'error': 'Missing name or organization_id'}), 400
    warehouse = Warehouse(name=data['name'], organization_id=data['organization_id'])
    db.session.add(warehouse)
    db.session.commit()
    return jsonify(warehouse.to_dict()), 201

@bp.route('/warehouses/<int:id>', methods=['PUT'])
def update_warehouse(id):
    """Update an existing warehouse."""
    data = request.get_json() or {}
    warehouse = Warehouse.query.get_or_404(id)
    if 'name' in data:
        warehouse.name = data['name']
    if 'organization_id' in data:
        warehouse.organization_id = data['organization_id']
    db.session.commit()
    return jsonify(warehouse.to_dict())

@bp.route('/warehouses/<int:id>', methods=['DELETE'])
def delete_warehouse(id):
    """Delete a warehouse."""
    warehouse = Warehouse.query.get_or_404(id)
    db.session.delete(warehouse)
    db.session.commit()
    return jsonify({'message': 'Deleted'})

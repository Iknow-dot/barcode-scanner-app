# app/views/organization.py

from flask import Blueprint, request, jsonify
from app import db
from app.models import Organization

bp = Blueprint('organization', __name__)

@bp.route('/organizations', methods=['GET'])
def get_organizations():
    """Retrieve a list of all organizations."""
    organizations = Organization.query.all()
    return jsonify([org.to_dict() for org in organizations])

@bp.route('/organizations/<int:id>', methods=['GET'])
def get_organization(id):
    """Retrieve a single organization by ID."""
    organization = Organization.query.get_or_404(id)
    return jsonify(organization.to_dict())

@bp.route('/organizations', methods=['POST'])
def create_organization():
    """Create a new organization."""
    data = request.get_json() or {}
    if 'name' not in data:
        return jsonify({'error': 'Missing name'}), 400
    organization = Organization(name=data['name'])
    db.session.add(organization)
    db.session.commit()
    return jsonify(organization.to_dict()), 201

@bp.route('/organizations/<int:id>', methods=['PUT'])
def update_organization(id):
    """Update an existing organization."""
    data = request.get_json() or {}
    organization = Organization.query.get_or_404(id)
    if 'name' in data:
        organization.name = data['name']
    db.session.commit()
    return jsonify(organization.to_dict())

@bp.route('/organizations/<int:id>', methods=['DELETE'])
def delete_organization(id):
    """Delete an organization."""
    organization = Organization.query.get_or_404(id)
    db.session.delete(organization)
    db.session.commit()
    return jsonify({'message': 'Deleted'})

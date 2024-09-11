from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app import db
from app.models import Organization
import uuid
from sqlalchemy.exc import IntegrityError

bp = Blueprint('organization', __name__)

@bp.route('/organizations', methods=['GET'])
@jwt_required()
def get_organizations():
    """Retrieve a list of all organizations."""
    organizations = Organization.query.all()
    return jsonify([org.to_dict() for org in organizations])

@bp.route('/organizations/<uuid:id>', methods=['GET'])
@jwt_required()
def get_organization(id):
    """Retrieve a single organization by ID."""
    organization = Organization.query.get_or_404(id)
    return jsonify(organization.to_dict())

@bp.route('/organizations', methods=['POST'])
@jwt_required()
def create_organization():
    """Create a new organization."""
    data = request.get_json() or {}
    if 'name' not in data or 'identification_code' not in data or 'web_service_url' not in data:
        return jsonify({'error': 'Missing required fields: name, identification_code, web_service_url'}), 400

    organization = Organization(
        name=data['name'],
        identification_code=data['identification_code'],
        web_service_url=data['web_service_url']
    )

    try:
        db.session.add(organization)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Organization with the same identification_code already exists'}), 400

    return jsonify(organization.to_dict()), 201

@bp.route('/organizations/<uuid:id>', methods=['PUT'])
@jwt_required()
def update_organization(id):
    """Update an existing organization."""
    data = request.get_json() or {}
    organization = Organization.query.get_or_404(id)

    if 'name' in data:
        organization.name = data['name']
    if 'identification_code' in data:
        organization.identification_code = data['identification_code']
    if 'web_service_url' in data:
        organization.web_service_url = data['web_service_url']

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Organization with the same identification_code already exists'}), 400

    return jsonify(organization.to_dict())

@bp.route('/organizations/<uuid:id>', methods=['DELETE'])
@jwt_required()
def delete_organization(id):
    """Delete an organization."""
    organization = Organization.query.get_or_404(id)
    db.session.delete(organization)
    db.session.commit()
    return jsonify({'message': 'Deleted'})
